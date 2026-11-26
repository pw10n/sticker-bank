import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { isApiError } from '../../api/errors'
import {
  useActiveChores,
  useBootstrap,
  useClosedChores,
  useFinishChore,
  usePendingPrizeRequest,
  useRemoveChore,
  useRevokeChoreSticker,
  useToggleChoreTask,
} from '../../api/hooks'
import type { Chore, ChartSticker } from '../../api/types'
import { Artwork } from '../../artwork'
import { Button, Card, ConfirmDialog, EmptyState, PageHeader, Select, Spinner } from '../../ui'
import { dayLabel } from '../history/dates'
import { StateBadge } from '../history/StateBadge'
import { RevokeSheet, USED_EXPLANATION } from '../shared/RevokeSheet'
import { ChoreFormSheet, type ChoreFormMode } from './ChoreForm'
import { STATUS_LABEL, dueText } from './choreUtils'
import { PickOffer } from './PickOffer'

type ChildRef = { id: number; name: string }
type PickInfo = { childId: number; childName: string; choreName: string; stickerId: number; autoAwarded: boolean }

export default function ChoresScreen() {
  const [params, setParams] = useSearchParams()
  const bootstrap = useBootstrap()
  const children: ChildRef[] = [...(bootstrap.data?.children ?? [])].sort((a, b) => a.position - b.position)
  const today = bootstrap.data?.today ?? ''
  const raw = Number(params.get('child'))
  const filter = Number.isInteger(raw) && raw > 0 ? raw : undefined
  const childName = (id: number) => children.find((c) => c.id === id)?.name ?? 'Child'

  const [form, setForm] = useState<ChoreFormMode | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [pickInfo, setPickInfo] = useState<PickInfo | null>(null)
  const [removing, setRemoving] = useState<Chore | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<{ chore: Chore; taskId: number; taskLabel: string } | null>(null)
  const remove = useRemoveChore()

  const setFilter = (id: number | undefined) => setParams(id ? { child: String(id) } : {}, { replace: true })

  const onRemove = () => {
    if (!removing) return
    const chore = removing
    remove.mutate(
      { choreId: chore.choreId, childId: chore.childId },
      {
        onSuccess: () => {
          setRemoving(null)
          setNote(`${chore.name} removed.`)
        },
        onError: (e) => {
          setRemoving(null)
          setNote(
            isApiError(e, 'CHORE_LOCKED')
              ? "That chore is already finished, so it can't be removed."
              : 'Could not remove that chore. Please try again.',
          )
        },
      },
    )
  }

  if (bootstrap.isPending) return <Spinner label="Loading" />

  return (
    <main data-testid="screen-chores-screen" className="mx-auto w-full max-w-3xl p-4">
      <PageHeader
        title="Chores"
        actions={
          <Button
            onClick={() => {
              setNote(null)
              setForm({ kind: 'assign', childIds: filter ? [filter] : [] })
            }}
          >
            Assign a chore
          </Button>
        }
      />
      {children.length >= 2 && (
        <div className="mb-4">
          <Select label="Child" value={filter ?? ''} onChange={(e) => setFilter(e.target.value ? Number(e.target.value) : undefined)}>
            <option value="">All children</option>
            {children.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
      )}
      {note && (
        <p role="status" data-testid="chores-note" className="mb-4 rounded-2xl bg-mint p-3 text-lg font-bold">
          {note}
        </p>
      )}
      {pickInfo && (
        <div className="mb-4">
          <PickOffer {...pickInfo} onDone={() => setPickInfo(null)} />
        </div>
      )}

      <section aria-labelledby="chores-todo" className="mb-8 flex flex-col gap-4">
        <h2 id="chores-todo" className="text-2xl font-bold">
          To do
        </h2>
        <TodoList
          filter={filter}
          children={children}
          today={today}
          childName={childName}
          onEdit={(c) => setForm({ kind: 'edit', chore: c })}
          onRemove={setRemoving}
          onPick={setPickInfo}
          onNote={setNote}
        />
      </section>

      <section aria-labelledby="chores-done" className="flex flex-col gap-4">
        <h2 id="chores-done" className="text-2xl font-bold">
          Done and missed
        </h2>
        <ClosedList
          filter={filter}
          childName={childName}
          onAssignAgain={(c) =>
            setForm({
              kind: 'assign',
              childIds: [c.childId],
              prefill: { name: c.name, iconKey: c.iconKey, tasks: c.tasks.map((t) => ({ label: t.label, iconKey: t.iconKey })) },
            })
          }
          onReopen={(c) => setForm({ kind: 'edit', chore: c, reopen: true })}
          onRemove={setRemoving}
          onUncheck={(chore, taskId, taskLabel) => {
            setNote(null)
            setRevokeTarget({ chore, taskId, taskLabel })
          }}
        />
      </section>

      {form && <ChoreFormSheet mode={form} onClose={() => setForm(null)} onSaved={setNote} />}
      <ConfirmDialog
        open={removing !== null}
        title="Remove this chore?"
        message={removing && `Remove '${removing.name}' from ${childName(removing.childId)}'s chores?`}
        confirmLabel="Remove"
        cancelLabel="Keep it"
        danger
        busy={remove.isPending}
        onCancel={() => setRemoving(null)}
        onConfirm={onRemove}
      />
      {revokeTarget && (
        <ChoreRevokeSheet
          {...revokeTarget}
          childName={childName(revokeTarget.chore.childId)}
          today={today}
          onClose={() => setRevokeTarget(null)}
          onDone={(message) => {
            setRevokeTarget(null)
            setPickInfo(null)
            setNote(message)
          }}
        />
      )}
    </main>
  )
}

function groupByChild(chores: Chore[], children: ChildRef[]): { id: number; chores: Chore[] }[] {
  const ids = [...children.map((c) => c.id), ...chores.map((c) => c.childId)]
  return [...new Set(ids)]
    .map((id) => ({ id, chores: chores.filter((c) => c.childId === id) }))
    .filter((g) => g.chores.length > 0)
}

function TodoList({
  filter,
  children,
  today,
  childName,
  onEdit,
  onRemove,
  onPick,
  onNote,
}: {
  filter?: number
  children: ChildRef[]
  today: string
  childName(id: number): string
  onEdit(c: Chore): void
  onRemove(c: Chore): void
  onPick(p: PickInfo): void
  onNote(m: string | null): void
}) {
  const q = useActiveChores({ childId: filter })
  if (q.isPending) return <Spinner />
  if (q.isError) return <p role="alert">Could not load chores.</p>
  if (q.data.length === 0) return <EmptyState icon="🧹" title="No chores to do" />
  return (
    <div className="flex flex-col gap-6">
      {groupByChild(q.data, children).map((g) => (
        <section key={g.id} aria-label={`${childName(g.id)}'s chores`} className="flex flex-col gap-3">
          <h3 className="text-xl font-bold">{childName(g.id)}</h3>
          <ul className="grid gap-3 lg:grid-cols-2">
            {g.chores.map((c) => (
              <ActiveChoreCard
                key={c.choreId}
                chore={c}
                childName={childName(c.childId)}
                today={today}
                onEdit={onEdit}
                onRemove={onRemove}
                onPick={onPick}
                onNote={onNote}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function ActiveChoreCard({
  chore,
  childName,
  today,
  onEdit,
  onRemove,
  onPick,
  onNote,
}: {
  chore: Chore
  childName: string
  today: string
  onEdit(c: Chore): void
  onRemove(c: Chore): void
  onPick(p: PickInfo): void
  onNote(m: string | null): void
}) {
  const toggle = useToggleChoreTask(chore.childId, 'today')
  const finish = useFinishChore(chore.childId, 'today')
  const [error, setError] = useState<string | null>(null)
  const ready = chore.state === 'READY_TO_FINISH'
  const busy = toggle.isPending || finish.isPending

  const onToggle = (taskId: number, done: boolean) => {
    if (busy) return
    setError(null)
    onNote(null)
    toggle.mutate(
      { choreId: chore.choreId, taskId, done },
      {
        onError: (e) =>
          setError(isApiError(e, 'CHORE_MISSED') ? 'The time for this chore is over.' : 'Could not update that task.'),
      },
    )
  }

  const onFinish = () => {
    if (busy) return
    setError(null)
    onNote(null)
    finish.mutate(
      { choreId: chore.choreId },
      {
        onSuccess: (res) => {
          if (res.pick)
            onPick({
              childId: chore.childId,
              childName,
              choreName: chore.name,
              stickerId: res.pick.stickerId,
              autoAwarded: res.pick.autoAwarded,
            })
        },
        onError: (e) =>
          setError(
            isApiError(e, 'CHORE_NOT_READY')
              ? 'Some tasks are not done yet.'
              : isApiError(e, 'CHORE_MISSED')
                ? 'The time for this chore is over.'
                : 'Could not finish that chore.',
          ),
      },
    )
  }

  return (
    <li aria-label={chore.name} data-testid={`chore-${chore.choreId}`}>
      <Card className="flex h-full flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Artwork artKey={chore.iconKey} size={40} decorative />
            <h4 className="text-lg font-bold break-words">{chore.name}</h4>
          </div>
          <StateBadge state={chore.state} doneCount={chore.doneCount} taskCount={chore.taskCount} />
        </div>
        <p data-testid="chore-due" className="text-sm font-semibold">
          {dueText(chore.dueDate, today)}
        </p>
        <p data-testid="chore-progress" className="text-sm font-semibold">
          {ready ? "All tasks done. Waiting for I'm Done!" : `${chore.doneCount} of ${chore.taskCount} done`}
        </p>
        <ul className="flex flex-col gap-1">
          {chore.tasks.map((t) => (
            <li key={t.taskId}>
              <label className="flex min-h-11 items-center gap-3 rounded-xl border-2 border-ink/10 px-3 font-semibold">
                <input
                  type="checkbox"
                  className="h-6 w-6"
                  checked={t.done}
                  disabled={busy}
                  onChange={(e) => onToggle(t.taskId, e.target.checked)}
                />
                {t.label}
              </label>
            </li>
          ))}
        </ul>
        {error && (
          <p role="alert" className="font-bold">
            {error}
          </p>
        )}
        {ready && (
          <div>
            <Button loading={finish.isPending} disabled={toggle.isPending} onClick={onFinish}>
              I&apos;m Done!
            </Button>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" aria-label={`Edit ${chore.name}`} onClick={() => onEdit(chore)}>
            Edit
          </Button>
          <Button variant="secondary" aria-label={`Remove ${chore.name}`} onClick={() => onRemove(chore)}>
            Remove
          </Button>
        </div>
      </Card>
    </li>
  )
}

function ClosedList({
  filter,
  childName,
  onAssignAgain,
  onReopen,
  onRemove,
  onUncheck,
}: {
  filter?: number
  childName(id: number): string
  onAssignAgain(c: Chore): void
  onReopen(c: Chore): void
  onRemove(c: Chore): void
  onUncheck(c: Chore, taskId: number, taskLabel: string): void
}) {
  const q = useClosedChores({ childId: filter })
  if (q.isPending) return <Spinner />
  if (q.isError) return <p role="alert">Could not load chores.</p>
  const items = q.data.pages.flatMap((p) => p.items)
  if (items.length === 0) return <EmptyState icon="📜" title="Nothing finished or missed yet" />
  return (
    <>
      <ul className="grid gap-3 lg:grid-cols-2">
        {items.map((c) => (
          <ClosedChoreCard
            key={c.choreId}
            chore={c}
            childName={childName(c.childId)}
            onAssignAgain={onAssignAgain}
            onReopen={onReopen}
            onRemove={onRemove}
            onUncheck={onUncheck}
          />
        ))}
      </ul>
      {q.hasNextPage && (
        <div>
          <Button variant="secondary" onClick={() => void q.fetchNextPage()} loading={q.isFetchingNextPage}>
            Load more
          </Button>
        </div>
      )}
    </>
  )
}

function StickerReview({ sticker }: { sticker: ChartSticker }) {
  return (
    <div className="flex items-center gap-3" data-testid="sticker-review">
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
          <span data-testid="sticker-status" className="inline-flex rounded-full border-2 border-ink px-2 py-0.5 text-sm font-bold">
            {STATUS_LABEL[sticker.status]}
          </span>
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

function ClosedChoreCard({
  chore,
  childName,
  onAssignAgain,
  onReopen,
  onRemove,
  onUncheck,
}: {
  chore: Chore
  childName: string
  onAssignAgain(c: Chore): void
  onReopen(c: Chore): void
  onRemove(c: Chore): void
  onUncheck(c: Chore, taskId: number, taskLabel: string): void
}) {
  const sticker = chore.sticker
  const finished = sticker !== null
  const used = finished && sticker.revocable === false
  const when = chore.closedOn ?? chore.dueDate
  return (
    <li aria-label={chore.name} data-testid={`chore-${chore.choreId}`}>
      <Card className="flex h-full flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Artwork artKey={chore.iconKey} size={40} decorative />
            <h4 className="text-lg font-bold break-words">{chore.name}</h4>
          </div>
          <StateBadge state={chore.state} doneCount={chore.doneCount} taskCount={chore.taskCount} />
        </div>
        <p className="text-sm font-semibold">
          {childName}
          {when ? ` · ${finished ? 'Finished' : 'Missed'} ${dayLabel(when)}` : ''}
        </p>
        {sticker && <StickerReview sticker={sticker} />}
        {finished && (
          <p className="text-sm font-bold">🔒 Sticker earned — locked. To remove the sticker, uncheck a done task.</p>
        )}
        {used && (
          <p id={`used-chore-${chore.choreId}`} className="text-sm font-semibold">
            {USED_EXPLANATION}
          </p>
        )}
        <ul className="flex flex-col gap-1">
          {chore.tasks.map((t) => (
            <li key={t.taskId}>
              {finished ? (
                <button
                  type="button"
                  aria-pressed={t.done}
                  aria-describedby={used ? `used-chore-${chore.choreId}` : undefined}
                  disabled={!t.done || used}
                  onClick={() => onUncheck(chore, t.taskId, t.label)}
                  className="flex min-h-11 w-full items-center gap-2 rounded-xl border-2 border-ink/10 px-3 text-left font-semibold focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-70"
                >
                  <span aria-hidden="true">{t.done ? '☑' : '☐'}</span>
                  {t.label}
                  <span className="sr-only">{t.done ? ' (done)' : ' (not done)'}</span>
                  {t.done && !used && (
                    <span className="ml-auto rounded-full border border-ink/40 px-2 text-sm font-bold">Uncheck</span>
                  )}
                </button>
              ) : (
                <p className="flex min-h-11 items-center gap-2 rounded-xl border-2 border-ink/10 px-3 font-semibold">
                  <span aria-hidden="true">{t.done ? '☑' : '☐'}</span>
                  {t.label}
                  <span className="sr-only">{t.done ? ' (done)' : ' (not done)'}</span>
                </p>
              )}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          {finished ? (
            <Button variant="secondary" aria-label={`Assign ${chore.name} again`} onClick={() => onAssignAgain(chore)}>
              Assign again
            </Button>
          ) : (
            <>
              <Button variant="secondary" aria-label={`Reopen ${chore.name}`} onClick={() => onReopen(chore)}>
                Reopen
              </Button>
              <Button variant="secondary" aria-label={`Remove ${chore.name}`} onClick={() => onRemove(chore)}>
                Remove
              </Button>
            </>
          )}
        </div>
      </Card>
    </li>
  )
}

function ChoreRevokeSheet({
  chore,
  taskId,
  taskLabel,
  childName,
  today,
  onClose,
  onDone,
}: {
  chore: Chore
  taskId: number
  taskLabel: string
  childName: string
  today: string
  onClose(): void
  onDone(message: string): void
}) {
  const revoke = useRevokeChoreSticker(chore.childId)
  const pendingRequest = usePendingPrizeRequest(chore.childId)
  const [note, setNote] = useState('')
  const [removeChore, setRemoveChore] = useState(false)
  const [errorKind, setErrorKind] = useState<'used' | 'other' | null>(null)
  const sticker = chore.sticker
  if (!sticker) return null

  const passed = chore.dueDate !== null && chore.dueDate < today
  const outcome = removeChore
    ? `${chore.name} will be removed.`
    : passed
      ? 'Its due date has passed, so it will show as Missed.'
      : `${chore.name} will go back on ${childName}'s chart.`

  const onConfirm = () => {
    if (revoke.isPending) return
    setErrorKind(null)
    revoke.mutate(
      { choreId: chore.choreId, taskId, note: note.trim() || undefined, removeChore: removeChore || undefined },
      {
        onSuccess: () => onDone(removeChore ? 'Sticker removed. The chore was removed too.' : 'Sticker removed.'),
        onError: (e) => setErrorKind(isApiError(e, 'STICKER_USED') ? 'used' : 'other'),
      },
    )
  }

  return (
    <RevokeSheet
      ownerKind="chore"
      ownerName={chore.name}
      taskLabel={taskLabel}
      childName={childName}
      date={chore.closedOn ?? today}
      sticker={sticker}
      lastInRequest={
        sticker.prizeRequestId != null &&
        pendingRequest.data?.id === sticker.prizeRequestId &&
        pendingRequest.data.stickerCount === 1
      }
      note={note}
      onNote={setNote}
      busy={revoke.isPending}
      errorKind={errorKind}
      onConfirm={onConfirm}
      onClose={onClose}
      outcome={outcome}
      removeChore={removeChore}
      onRemoveChoreChange={setRemoveChore}
    />
  )
}
