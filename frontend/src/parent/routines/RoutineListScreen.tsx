import { useState } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import {
  useBootstrap,
  useChildren,
  useCopyRoutine,
  useDeleteRoutine,
  useReorderRoutines,
  useRoutines,
  useSkipRoutine,
  useUnskipRoutine,
} from '../../api/hooks'
import { isApiError } from '../../api/errors'
import type { Routine } from '../../api/types'
import { Artwork } from '../../artwork'
import { Button, Card, ConfirmDialog, EmptyState, IconButton, PageHeader, Sheet, Spinner } from '../../ui'
import { formatDate, moveIndex, scheduleSummary } from './schedule'
import { SortableList, SortableRow } from './Sortable'

const LINK_BTN =
  'inline-flex min-h-11 items-center justify-center rounded-2xl border-2 border-ink/30 bg-white px-4 text-base font-bold text-ink shadow-[0_3px_0_rgba(27,27,47,0.12)] focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-ink'
const PRIMARY_LINK =
  'inline-flex min-h-11 items-center justify-center rounded-2xl bg-sunshine px-5 text-base font-bold text-ink shadow-[0_4px_0_rgba(27,27,47,0.25)] focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-ink'

export default function RoutineListScreen() {
  const childId = Number(useParams().childId)
  const location = useLocation()
  const initialNotice = (location.state as { notice?: string } | null)?.notice ?? null

  const children = useChildren()
  const routinesQ = useRoutines(childId)
  const bootstrap = useBootstrap()
  const reorder = useReorderRoutines(childId)
  const del = useDeleteRoutine(childId)
  const copy = useCopyRoutine()
  const skip = useSkipRoutine()
  const unskip = useUnskipRoutine()

  const [notice, setNotice] = useState<{ kind: 'info' | 'error'; text: string } | null>(
    initialNotice ? { kind: 'info', text: initialNotice } : null,
  )
  const [deleting, setDeleting] = useState<Routine | null>(null)
  const [copying, setCopying] = useState<Routine | null>(null)

  const today = bootstrap.data?.today
  const child = children.data?.find((c) => c.id === childId)
  const routines = [...(routinesQ.data ?? [])].sort((a, b) => a.position - b.position)
  const others = (children.data ?? []).filter((c) => c.id !== childId)

  const applyOrder = (from: number, to: number) => {
    const next = moveIndex(routines, from, to)
    if (next === routines) return
    reorder.mutate({ routineIds: next.map((r) => r.id) })
  }

  const doSkip = (r: Routine) => {
    if (!today) return
    setNotice(null)
    skip.mutate(
      { routineId: r.id, childId, date: today },
      {
        onSuccess: () => setNotice({ kind: 'info', text: `${r.name} is skipped today.` }),
        onError: (e) =>
          setNotice({
            kind: 'error',
            text: isApiError(e, 'ROUTINE_LOCKED')
              ? "Today's sticker is already earned"
              : "Couldn't skip. Please try again.",
          }),
      },
    )
  }

  const doUnskip = (r: Routine, date: string) => {
    setNotice(null)
    unskip.mutate(
      { routineId: r.id, childId, date },
      { onError: () => setNotice({ kind: 'error', text: "Couldn't undo the skip. Please try again." }) },
    )
  }

  const doCopy = (r: Routine, targetId: number, targetName: string) => {
    copy.mutate(
      { routineId: r.id, targetChildId: targetId },
      {
        onSuccess: () => {
          setCopying(null)
          setNotice({ kind: 'info', text: `Copied ${r.name} to ${targetName}.` })
        },
        onError: () => {
          setCopying(null)
          setNotice({ kind: 'error', text: "Couldn't copy. Please try again." })
        },
      },
    )
  }

  const doDelete = () => {
    if (!deleting) return
    const r = deleting
    del.mutate(
      { routineId: r.id },
      {
        onSuccess: (result) => {
          setDeleting(null)
          setNotice({
            kind: 'info',
            text:
              today && result.effectiveFrom > today
                ? "It stays on today's chart because today's sticker is already earned; it's gone from tomorrow."
                : `${r.name} was deleted.`,
          })
        },
        onError: () => {
          setDeleting(null)
          setNotice({ kind: 'error', text: "Couldn't delete. Please try again." })
        },
      },
    )
  }

  return (
    <main data-testid="screen-routine-list-screen" className="mx-auto flex max-w-2xl flex-col gap-4 p-4">
      <PageHeader
        title={child ? `${child.name}'s routines` : 'Routines'}
        back={{ to: '/parent/children', label: 'Children' }}
        actions={
          <Link to={`/parent/routines/new?childId=${childId}`} className={PRIMARY_LINK}>
            New routine
          </Link>
        }
      />
      {notice && (
        <p
          role={notice.kind === 'error' ? 'alert' : 'status'}
          className="rounded-2xl border-2 border-ink/20 bg-white px-4 py-3 text-base font-bold"
        >
          {notice.text}
        </p>
      )}
      {routinesQ.isPending && <Spinner label="Loading routines" />}
      {routinesQ.isError && <p role="alert">Couldn't load the routines. Please try again.</p>}
      {routinesQ.isSuccess && routines.length === 0 && (
        <EmptyState
          icon="📋"
          title="No routines yet"
          message="Create a routine, like a morning or bedtime checklist."
          action={
            <Link to={`/parent/routines/new?childId=${childId}`} className={PRIMARY_LINK}>
              New routine
            </Link>
          }
        />
      )}
      {routines.length > 0 && (
        <SortableList ids={routines.map((r) => r.id)} onReorder={applyOrder}>
          <ul className="flex flex-col gap-3">
            {routines.map((r, i) => {
              const tomorrow = today !== undefined && r.effectiveFrom > today
              const skippedToday = today !== undefined && r.upcomingSkips.includes(today)
              return (
                <SortableRow key={r.id} id={r.id} handleLabel={`Drag to reorder ${r.name}`}>
                  {(handle) => (
                    <Card accent={r.color ?? undefined}>
                      <div className="flex items-center gap-3">
                        {handle}
                        <Artwork artKey={r.iconKey} size={48} decorative />
                        <div className="min-w-0 flex-1">
                          <h2 className="truncate text-xl font-bold">{r.name}</h2>
                          <p className="text-base">
                            {scheduleSummary(r.days)} · {r.tasks.length} {r.tasks.length === 1 ? 'task' : 'tasks'}
                          </p>
                        </div>
                        <div className="flex flex-col gap-1">
                          <IconButton
                            label={`Move ${r.name} up`}
                            icon="↑"
                            disabled={i === 0}
                            onClick={() => applyOrder(i, i - 1)}
                          />
                          <IconButton
                            label={`Move ${r.name} down`}
                            icon="↓"
                            disabled={i === routines.length - 1}
                            onClick={() => applyOrder(i, i + 1)}
                          />
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm font-bold">
                        {r.paused && (
                          <span className="rounded-full bg-sand px-3 py-1 text-ink">Paused</span>
                        )}
                        {tomorrow && <span className="rounded-full bg-sky px-3 py-1">Changes start tomorrow</span>}
                      </div>
                      {r.upcomingSkips.length > 0 && (
                        <ul className="mt-2 flex flex-col gap-1">
                          {r.upcomingSkips.map((d) => (
                            <li key={d} className="flex items-center gap-2 text-base">
                              <span>Skipped {formatDate(d)}</span>
                              <Button
                                variant="ghost"
                                className="underline"
                                aria-label={`Undo skip ${formatDate(d)} for ${r.name}`}
                                onClick={() => doUnskip(r, d)}
                              >
                                Undo skip
                              </Button>
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Link to={`/parent/routines/${r.id}`} className={LINK_BTN} aria-label={`Edit ${r.name}`}>
                          Edit
                        </Link>
                        {!skippedToday && (
                          <Button
                            variant="secondary"
                            aria-label={`Skip ${r.name} today`}
                            disabled={!today}
                            onClick={() => doSkip(r)}
                          >
                            Skip today
                          </Button>
                        )}
                        <Button variant="secondary" aria-label={`Copy ${r.name} to…`} onClick={() => setCopying(r)}>
                          Copy to…
                        </Button>
                        <Button variant="secondary" aria-label={`Delete ${r.name}`} onClick={() => setDeleting(r)}>
                          Delete
                        </Button>
                      </div>
                    </Card>
                  )}
                </SortableRow>
              )
            })}
          </ul>
        </SortableList>
      )}

      <ConfirmDialog
        open={deleting !== null}
        danger
        busy={del.isPending}
        title="Delete routine?"
        message={deleting ? `Delete ${deleting.name}? Stickers already earned from it are kept.` : ''}
        onConfirm={doDelete}
        onCancel={() => setDeleting(null)}
      />
      <Sheet
        open={copying !== null}
        onClose={() => setCopying(null)}
        title={copying ? `Copy ${copying.name} to…` : 'Copy routine'}
        footer={
          <Button variant="secondary" onClick={() => setCopying(null)}>
            Cancel
          </Button>
        }
      >
        <p className="mb-3 text-base">Each child gets their own copy.</p>
        {others.length === 0 ? (
          <p>There are no other children to copy to.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {others.map((c) => (
              <li key={c.id}>
                <Button
                  variant="secondary"
                  size="lg"
                  className="w-full justify-start"
                  disabled={copy.isPending}
                  onClick={() => copying && doCopy(copying, c.id, c.name)}
                >
                  <Artwork artKey={c.avatarKey} size={32} decorative />
                  {c.name}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Sheet>
    </main>
  )
}
