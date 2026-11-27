import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { isApiError } from '../../api/errors'
import {
  useBootstrap,
  useDailyChart,
  useFinishRoutine,
  useHistory,
  usePendingPrizeRequest,
  useRevokeChoreSticker,
  useRevokeSticker,
  useSkipRoutine,
  useToggleTask,
  useUnskipRoutine,
} from '../../api/hooks'
import type { ChartChore, ChartRoutine, ChartSticker, StickerPick, StickerStatus } from '../../api/types'
import { Artwork } from '../../artwork'
import { useMode } from '../../app'
import { Button, Sheet, Spinner } from '../../ui'
import { dayLabel } from './dates'
import { StateBadge } from './StateBadge'
import { RevokeSheet, USED_EXPLANATION } from '../shared/RevokeSheet'

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
        <div className="flex flex-wrap gap-1">
          <span
            data-testid="sticker-status"
            className="inline-flex rounded-full border-2 border-ink px-2 py-0.5 text-sm font-bold"
          >
            {STATUS_LABEL[sticker.status]}
          </span>
          {/* FR-6.11: the day ended before I'm Done! was tapped, so check the tasks were really done. */}
          {sticker.autoFinished && (
            <span
              data-testid="sticker-auto-finished"
              className="inline-flex rounded-full border-2 border-ink/40 bg-sunshine/30 px-2 py-0.5 text-sm font-bold"
            >
              Finished automatically
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

function timeLabel(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

type RevokeTarget = {
  taskId: number
  taskLabel: string
  routineName: string
  sticker: ChartSticker
  /** Set when the task belongs to a chore. */
  chore?: { choreId: number; dueDate: string | null }
}

type PickInfo = { pick: StickerPick; routineName: string }

export function DayDetail({ childId, childName, date, onClose, onChanged }: Props) {
  const navigate = useNavigate()
  const { exitParentMode } = useMode()
  const chart = useDailyChart(childId, date, { poll: false })
  const toggle = useToggleTask(childId, date)
  const finish = useFinishRoutine(childId, date)
  const skip = useSkipRoutine()
  const unskip = useUnskipRoutine()
  const [pickInfo, setPickInfo] = useState<PickInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<RevokeTarget | null>(null)
  const [revokeError, setRevokeError] = useState<'used' | 'other' | null>(null)
  const [revokeNote, setRevokeNote] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const revoke = useRevokeSticker(childId, date)
  const revokeChore = useRevokeChoreSticker(childId)
  const [removeChoreToo, setRemoveChoreToo] = useState(false)
  const today = useBootstrap().data?.today
  const pendingRequest = usePendingPrizeRequest(childId)
  const history = useHistory(childId, date, date)
  const revocations = history.data?.days.find((d) => d.date === date)?.revocations ?? []

  const closeRevoke = () => {
    setRevokeTarget(null)
    setRevokeError(null)
    setRevokeNote('')
    setRemoveChoreToo(false)
  }

  const onRevoke = () => {
    if (revokeTarget == null || revoke.isPending || revokeChore.isPending) return
    const { taskId, chore } = revokeTarget
    const trimmed = revokeNote.trim()
    setRevokeError(null)
    const callbacks = {
      onSuccess: () => {
        closeRevoke()
        setPickInfo(null)
        setNote('Sticker removed.')
        onChanged()
      },
      onError: (e: unknown) => {
        if (isApiError(e, 'STICKER_USED')) setRevokeError('used')
        else setRevokeError('other')
        void chart.refetch()
      },
    }
    if (chore) {
      revokeChore.mutate(
        { choreId: chore.choreId, taskId, note: trimmed || undefined, removeChore: removeChoreToo },
        callbacks,
      )
    } else {
      revoke.mutate({ taskId, note: trimmed || undefined }, callbacks)
    }
  }

  const startChoreRevoke = (c: ChartChore, taskId: number) => {
    if (revokeChore.isPending || !c.sticker) return
    setError(null)
    setNote(null)
    setRevokeError(null)
    setRevokeNote('')
    setRemoveChoreToo(false)
    setRevokeTarget({
      taskId,
      taskLabel: c.tasks.find((t) => t.taskId === taskId)?.label ?? '',
      routineName: c.name,
      sticker: c.sticker,
      chore: { choreId: c.choreId, dueDate: c.dueDate },
    })
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
        onSuccess: () => onChanged(),
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

  /** I'm Done! for a routine whose tasks are all checked (FR-6.5). This is what earns the sticker, never the last check. */
  const onFinish = (r: ChartRoutine) => {
    setNote(null)
    if (finish.isPending || toggle.isPending) return
    setError(null)
    finish.mutate(
      { routineId: r.routineId, date },
      {
        onSuccess: (res) => {
          onChanged()
          if (res.pick) setPickInfo({ pick: res.pick, routineName: r.name })
        },
        onError: (e) =>
          setError(
            isApiError(e, 'ROUTINE_NOT_READY')
              ? 'Some tasks are not done yet.'
              : isApiError(e, 'DAY_CHANGED')
                ? 'A new day has started. Please reopen Parent Mode.'
                : 'Could not finish that routine.',
          ),
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
      {chart.data && chart.data.routines.length === 0 && (chart.data.chores ?? []).length === 0 && (
        <p>No routines on this day.</p>
      )}
      <ul className="flex flex-col gap-4">
        {chart.data?.routines.map((r) => {
          const locked = r.state === 'EARNED' || r.state === 'AWAITING_PICK'
          const skipped = r.state === 'SKIPPED'
          const ready = r.state === 'READY_TO_FINISH'
          const used = locked && r.sticker?.revocable === false
          return (
            <li key={r.routineId} aria-label={r.name} className="rounded-2xl border-2 border-ink/10 p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-lg font-bold">{r.name}</h3>
                <StateBadge state={r.state} doneCount={r.doneCount} taskCount={r.taskCount} />
              </div>
              {!locked && !skipped && (
                <p className="mb-2 text-sm font-semibold">
                  {ready ? "All tasks done. Waiting for I'm Done!" : `${r.doneCount} of ${r.taskCount} done`}
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
              {ready && (
                <div className="mt-2">
                  <Button loading={finish.isPending} disabled={toggle.isPending || revoke.isPending} onClick={() => onFinish(r)}>
                    I&apos;m Done!
                  </Button>
                </div>
              )}
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
      {(chart.data?.chores ?? []).length > 0 && (
        <section aria-label="Chores" data-testid="day-chores" className="mt-4">
          <h3 className="mb-2 text-lg font-bold">Chores</h3>
          <ul className="flex flex-col gap-4">
            {chart.data?.chores.map((c) => {
              const finished = c.state === 'EARNED' || c.state === 'AWAITING_PICK'
              const usedChore = finished && c.sticker?.revocable === false
              const unfinished =
                c.state === 'NOT_STARTED' || c.state === 'IN_PROGRESS' || c.state === 'READY_TO_FINISH'
              return (
                <li
                  key={`chore-${c.choreId}`}
                  aria-label={c.name}
                  data-testid={`chore-${c.choreId}`}
                  className="rounded-2xl border-2 border-ink/10 p-3"
                >
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <h4 className="text-lg font-bold">{c.name}</h4>
                    <StateBadge state={c.state} doneCount={c.doneCount} taskCount={c.taskCount} />
                  </div>
                  <p className="mb-2 text-sm font-semibold">
                    {c.doneCount} of {c.taskCount} done
                    {c.dueDate ? ` · Due ${dayLabel(c.dueDate)}` : ''}
                  </p>
                  {c.sticker && <StickerReview sticker={c.sticker} />}
                  {finished && (
                    <p className="mb-2 text-sm font-bold">
                      🔒 Sticker earned — locked. To remove the sticker, uncheck a done task.
                    </p>
                  )}
                  {usedChore && (
                    <p id={`used-chore-${c.choreId}`} className="mb-2 text-sm font-semibold">
                      {USED_EXPLANATION}
                    </p>
                  )}
                  <ul className="flex flex-col gap-1">
                    {c.tasks.map((t) =>
                      finished ? (
                        <li key={t.taskId}>
                          <button
                            type="button"
                            aria-pressed={t.done}
                            aria-describedby={usedChore ? `used-chore-${c.choreId}` : undefined}
                            disabled={revokeChore.isPending || !t.done || usedChore}
                            onClick={() => startChoreRevoke(c, t.taskId)}
                            className="flex min-h-11 w-full items-center gap-2 rounded-xl border-2 border-ink/10 px-3 text-left font-semibold focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-70"
                          >
                            <span aria-hidden="true">{t.done ? '☑' : '☐'}</span>
                            {t.label}
                            <span className="sr-only">{t.done ? ' (done)' : ' (not done)'}</span>
                            {t.done && !usedChore && (
                              <span className="ml-auto rounded-full border border-ink/40 px-2 text-sm font-bold">Uncheck</span>
                            )}
                          </button>
                        </li>
                      ) : (
                        <li
                          key={t.taskId}
                          className="flex min-h-11 items-center gap-2 rounded-xl border-2 border-ink/10 px-3 font-semibold"
                        >
                          <span aria-hidden="true">{t.done ? '☑' : '☐'}</span>
                          {t.label}
                          <span className="sr-only">{t.done ? ' (done)' : ' (not done)'}</span>
                        </li>
                      ),
                    )}
                  </ul>
                  {unfinished && today === date && (
                    <Link
                      to={`/parent/chores?child=${childId}`}
                      className="mt-2 inline-flex min-h-11 items-center font-bold underline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-ink"
                    >
                      Manage chores
                    </Link>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}
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
          ownerKind={revokeTarget.chore ? 'chore' : 'routine'}
          ownerName={revokeTarget.routineName}
          taskLabel={revokeTarget.taskLabel}
          sticker={revokeTarget.sticker}
          childName={childName}
          date={date}
          lastInRequest={
            revokeTarget.sticker.prizeRequestId != null &&
            pendingRequest.data?.id === revokeTarget.sticker.prizeRequestId &&
            pendingRequest.data.stickerCount === 1
          }
          note={revokeNote}
          onNote={setRevokeNote}
          busy={revoke.isPending || revokeChore.isPending}
          errorKind={revokeError}
          {...(revokeTarget.chore
            ? {
                outcome: removeChoreToo
                  ? `${revokeTarget.routineName} will be removed.`
                  : revokeTarget.chore.dueDate && today && revokeTarget.chore.dueDate < today
                    ? 'Its due date has passed, so it will show as Missed.'
                    : `${revokeTarget.routineName} will go back on ${childName}'s chart.`,
                removeChore: removeChoreToo,
                onRemoveChoreChange: setRemoveChoreToo,
              }
            : {})}
          onConfirm={onRevoke}
          onClose={closeRevoke}
        />
      )}
    </Sheet>
  )
}
