import { useState } from 'react'
import { useNavigate } from 'react-router'
import { isApiError } from '../../api/errors'
import {
  useDailyChart,
  useHistory,
  usePendingPrizeRequest,
  useRevokeSticker,
  useSkipRoutine,
  useToggleTask,
  useUnskipRoutine,
} from '../../api/hooks'
import type { ChartRoutine, ChartSticker, StickerPick, StickerStatus } from '../../api/types'
import { Artwork } from '../../artwork'
import { useMode } from '../../app'
import { Button, Sheet, Spinner, TextArea } from '../../ui'
import { dayLabel } from './dates'
import { StateBadge } from './StateBadge'

type Props = {
  childId: number
  childName: string
  date: string
  onClose(): void
  onChanged(): void
}

const STATUS_LABEL: Record<StickerStatus, string> = {
  UNCLAIMED: 'Unclaimed',
  AVAILABLE: 'Available',
  PENDING: 'Pending',
  USED: 'Used',
  REVOKED: 'Removed',
}

const USED_EXPLANATION = "This sticker was already spent on a prize, so it can't be taken back."

function StickerReview({ sticker }: { sticker: ChartSticker }) {
  return (
    <div className="mb-2 flex items-center gap-3" data-testid="sticker-review">
      {sticker.design ? (
        <Artwork artKey={sticker.design.artworkKey} size={48} alt="" decorative />
      ) : (
        <span aria-hidden="true" className="text-3xl">
          ⭐
        </span>
      )}
      <div className="flex flex-col items-start gap-1">
        <p className="font-bold">{sticker.design ? sticker.design.name : 'Not picked yet'}</p>
        <span
          data-testid="sticker-status"
          className="inline-flex rounded-full border-2 border-ink px-2 py-0.5 text-sm font-bold"
        >
          {STATUS_LABEL[sticker.status]}
        </span>
      </div>
    </div>
  )
}

function timeLabel(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

type RevokeTarget = { taskId: number; taskLabel: string; routineName: string; sticker: ChartSticker }

type PickInfo = { pick: StickerPick; routineName: string }

export function DayDetail({ childId, childName, date, onClose, onChanged }: Props) {
  const navigate = useNavigate()
  const { exitParentMode } = useMode()
  const chart = useDailyChart(childId, date, { poll: false })
  const toggle = useToggleTask(childId, date)
  const skip = useSkipRoutine()
  const unskip = useUnskipRoutine()
  const [pickInfo, setPickInfo] = useState<PickInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<RevokeTarget | null>(null)
  const [revokeError, setRevokeError] = useState<'used' | 'other' | null>(null)
  const [revokeNote, setRevokeNote] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const revoke = useRevokeSticker(childId, date)
  const pendingRequest = usePendingPrizeRequest(childId)
  const history = useHistory(childId, date, date)
  const revocations = history.data?.days.find((d) => d.date === date)?.revocations ?? []

  const closeRevoke = () => {
    setRevokeTarget(null)
    setRevokeError(null)
    setRevokeNote('')
  }

  const onRevoke = () => {
    if (revokeTarget == null || revoke.isPending) return
    const { taskId } = revokeTarget
    const trimmed = revokeNote.trim()
    setRevokeError(null)
    revoke.mutate(
      { taskId, note: trimmed || undefined },
      {
        onSuccess: () => {
          closeRevoke()
          setPickInfo(null)
          setNote('Sticker removed.')
          onChanged()
        },
        onError: (e) => {
          if (isApiError(e, 'STICKER_USED')) setRevokeError('used')
          else setRevokeError('other')
          void chart.refetch()
        },
      },
    )
  }

  const startRevoke = (r: ChartRoutine, taskId: number) => {
    if (toggle.isPending || revoke.isPending || !r.sticker) return
    setError(null)
    setNote(null)
    const task = r.tasks.find((t) => t.taskId === taskId)
    setRevokeError(null)
    setRevokeNote('')
    setRevokeTarget({ taskId, taskLabel: task?.label ?? '', routineName: r.name, sticker: r.sticker })
  }

  const onToggle = (r: ChartRoutine, taskId: number, done: boolean) => {
    setNote(null)
    // One toggle at a time: an earlier response must not overwrite a later optimistic update,
    // and only the latest mutate() call's callbacks run, so the final pick must not be dropped.
    if (toggle.isPending) return
    setError(null)
    toggle.mutate(
      { taskId, date, done },
      {
        onSuccess: (res) => {
          onChanged()
          if (res.pick) setPickInfo({ pick: res.pick, routineName: r.name })
        },
        onError: (e) => {
          if (isApiError(e, 'REVOKE_CONFIRMATION_REQUIRED')) {
            const sticker = e.problem?.sticker
            if (sticker) {
              setRevokeError(null)
              setRevokeNote('')
              setRevokeTarget({ taskId, taskLabel: r.tasks.find((t) => t.taskId === taskId)?.label ?? '', routineName: r.name, sticker })
              return
            }
          }
          setError(isApiError(e, 'ROUTINE_LOCKED') ? 'Already earned — locked.' : 'Could not update that task.')
        },
      },
    )
  }

  const onSkip = (r: ChartRoutine, skipping: boolean) => {
    setError(null)
    const m = skipping ? skip : unskip
    m.mutate(
      { routineId: r.routineId, childId, date },
      {
        onSuccess: onChanged,
        onError: (e) =>
          setError(
            isApiError(e, 'ROUTINE_LOCKED')
              ? "Already earned — can't skip"
              : isApiError(e, 'ROUTINE_NOT_SCHEDULED')
                ? 'That routine is not scheduled on this day.'
                : 'Could not change the skip.',
          ),
      },
    )
  }

  const pickNow = async () => {
    if (!pickInfo) return
    await exitParentMode()
    navigate(`/c/${childId}/pick/${pickInfo.pick.stickerId}`)
  }

  return (
    <Sheet open onClose={onClose} title={dayLabel(date, true)} footer={<Button onClick={onClose}>Close</Button>}>
      {pickInfo &&
        (pickInfo.pick.autoAwarded ? (
          <div role="status" className="mb-4 rounded-2xl border-2 border-sunshine bg-sunshine/20 p-3 font-bold">
            {childName} earned a sticker for {pickInfo.routineName}! A Gold Star was added.
            <div className="mt-2">
              <Button onClick={() => setPickInfo(null)}>OK</Button>
            </div>
          </div>
        ) : (
          <div role="status" className="mb-4 rounded-2xl border-2 border-sunshine bg-sunshine/20 p-3">
            <p className="font-bold">
              {childName} earned a sticker for {pickInfo.routineName}!
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button onClick={() => void pickNow()}>Let {childName} pick now</Button>
              <Button variant="secondary" onClick={() => setPickInfo(null)}>
                Later — it waits in their &apos;Stickers to pick&apos; tray
              </Button>
            </div>
          </div>
        ))}
      {error && (
        <p role="alert" className="mb-3 font-bold text-ink">
          {error}
        </p>
      )}
      {note && (
        <p role="status" className="mb-3 rounded-2xl border-2 border-ink/20 bg-paper p-3 font-bold">
          {note}
        </p>
      )}
      {chart.isPending && <Spinner />}
      {chart.isError && <p role="alert">Could not load this day.</p>}
      {chart.data && chart.data.routines.length === 0 && <p>No routines on this day.</p>}
      <ul className="flex flex-col gap-4">
        {chart.data?.routines.map((r) => {
          const locked = r.state === 'EARNED' || r.state === 'AWAITING_PICK'
          const skipped = r.state === 'SKIPPED'
          const used = locked && r.sticker?.revocable === false
          return (
            <li key={r.routineId} aria-label={r.name} className="rounded-2xl border-2 border-ink/10 p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-lg font-bold">{r.name}</h3>
                <StateBadge state={r.state} doneCount={r.doneCount} taskCount={r.taskCount} />
              </div>
              {!locked && !skipped && (
                <p className="mb-2 text-sm font-semibold">
                  {r.doneCount} of {r.taskCount} done
                </p>
              )}
              {r.sticker && <StickerReview sticker={r.sticker} />}
              {locked && (
                <p className="mb-2 text-sm font-bold">
                  🔒 Sticker earned — locked. To remove the sticker, uncheck a done task.
                </p>
              )}
              {used && (
                <p id={`used-${r.routineId}`} className="mb-2 text-sm font-semibold">
                  {USED_EXPLANATION}
                </p>
              )}
              <ul className="flex flex-col gap-1">
                {r.tasks.map((t) => (
                  <li key={t.taskId}>
                    <button
                      type="button"
                      aria-pressed={t.done}
                      aria-describedby={used ? `used-${r.routineId}` : undefined}
                      disabled={
                        skipped || toggle.isPending || revoke.isPending || (locked && (!t.done || used))
                      }
                      onClick={() => (locked ? startRevoke(r, t.taskId) : onToggle(r, t.taskId, !t.done))}
                      className="flex min-h-11 w-full items-center gap-2 rounded-xl border-2 border-ink/10 px-3 text-left font-semibold focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-70"
                    >
                      <span aria-hidden="true">{t.done ? '☑' : '☐'}</span>
                      {t.label}
                      <span className="sr-only">{t.done ? ' (done)' : ' (not done)'}</span>
                      {locked && t.done && !used && (
                        <span className="ml-auto rounded-full border border-ink/40 px-2 text-sm font-bold">Uncheck</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
              {!locked && (
                <div className="mt-2">
                  {skipped ? (
                    <Button variant="secondary" onClick={() => onSkip(r, false)}>
                      Un-skip
                    </Button>
                  ) : (
                    <Button variant="secondary" onClick={() => onSkip(r, true)}>
                      Skip this day
                    </Button>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {revocations.length > 0 && (
        <section aria-label="Removed stickers" className="mt-4">
          <h3 className="mb-1 text-lg font-bold">Removed stickers</h3>
          <ul className="flex flex-col gap-2 text-sm">
            {revocations.map((v) => (
              <li key={v.stickerId}>
                <p>
                  ↩ {v.taskLabel} unchecked, {v.design?.name ?? 'unpicked sticker'} removed
                  {timeLabel(v.revokedAt) ? ` at ${timeLabel(v.revokedAt)}` : ''}
                </p>
                {v.requestCancelled && <p>Prize request cancelled</p>}
                {v.note && <p>{v.note}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {revokeTarget && (
        <RevokeSheet
          childName={childName}
          date={date}
          target={revokeTarget}
          lastInRequest={
            revokeTarget.sticker.prizeRequestId != null &&
            pendingRequest.data?.id === revokeTarget.sticker.prizeRequestId &&
            pendingRequest.data.stickerCount === 1
          }
          note={revokeNote}
          onNote={setRevokeNote}
          busy={revoke.isPending}
          errorKind={revokeError}
          onConfirm={onRevoke}
          onClose={closeRevoke}
        />
      )}
    </Sheet>
  )
}

function RevokeSheet({
  childName,
  date,
  target,
  lastInRequest,
  note,
  onNote,
  busy,
  errorKind,
  onConfirm,
  onClose,
}: {
  childName: string
  date: string
  target: RevokeTarget
  lastInRequest: boolean
  note: string
  onNote(v: string): void
  busy: boolean
  errorKind: 'used' | 'other' | null
  onConfirm(): void
  onClose(): void
}) {
  const { sticker, taskLabel, routineName } = target
  const blocked = sticker.revocable === false || errorKind === 'used'
  return (
    <Sheet
      open
      onClose={busy ? () => {} : onClose}
      title="Remove this sticker?"
      footer={
        <div className="flex flex-wrap gap-2">
          {!blocked && (
            <Button variant="danger" loading={busy} onClick={onConfirm}>
              Remove sticker
            </Button>
          )}
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            {blocked ? 'OK' : 'Cancel'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          {sticker.design ? (
            <>
              <Artwork artKey={sticker.design.artworkKey} size={64} alt="" decorative />
              <span className="font-bold">{sticker.design.name}</span>
            </>
          ) : (
            <span className="font-bold">Not picked yet</span>
          )}
        </div>
        <p>
          Unchecking &apos;{taskLabel}&apos; in {routineName} on {dayLabel(date, true)} removes this sticker from{' '}
          {childName}&apos;s Sticker Book. The routine won&apos;t be finished until it&apos;s done again.
        </p>
        {blocked ? (
          <p role="alert" className="font-bold">
            {USED_EXPLANATION}
          </p>
        ) : (
          <>
            {sticker.status === 'PENDING' && (
              <p className="font-bold">
                This sticker is in a prize request. It will be taken out
                {lastInRequest ? ', and the request will be cancelled' : ''}.
              </p>
            )}
            <TextArea
              label="Note (optional)"
              maxLength={200}
              value={note}
              onChange={(e) => onNote(e.target.value)}
              disabled={busy}
            />
            {errorKind === 'other' && (
              <p role="alert" className="font-bold">
                Could not remove the sticker. Please try again.
              </p>
            )}
          </>
        )}
      </div>
    </Sheet>
  )
}
