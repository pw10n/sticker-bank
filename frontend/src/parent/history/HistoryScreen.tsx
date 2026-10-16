import { useState } from 'react'
import { useParams } from 'react-router'
import { useBootstrap, useChildren, useHistory } from '../../api/hooks'
import type { HistoryDay } from '../../api/types'
import { Artwork } from '../../artwork'
import { Card, EmptyState, PageHeader, Spinner, Button } from '../../ui'
import { addDays, dayLabel, weekDates, weekStart } from './dates'
import { DayDetail } from './DayDetail'
import { StateBadge } from './StateBadge'

const LEGEND = ['EARNED', 'AWAITING_PICK', 'READY_TO_FINISH', 'MISSED', 'SKIPPED', 'IN_PROGRESS'] as const

export default function HistoryScreen() {
  const params = useParams()
  const childId = Number(params.childId)
  const bootstrap = useBootstrap()
  const children = useChildren()
  const today = bootstrap.data?.today
  const child = children.data?.find((c) => c.id === childId)
  const [offset, setOffset] = useState(0) // weeks relative to the current week
  const [openDate, setOpenDate] = useState<string | null>(null)

  const start = today ? addDays(weekStart(today), offset * 7) : ''
  const end = start ? addDays(start, 6) : ''
  const to = today && end > today ? today : end
  const history = useHistory(childId, start, to)
  const isCurrentWeek = !!today && end >= today

  const header = (
    <PageHeader
      title={child ? `${child.name}'s history` : 'History'}
      back={{ to: '/parent/children', label: 'Children' }}
      actions={child ? <Artwork artKey={child.avatarKey} size={48} alt={`${child.name}'s avatar`} /> : undefined}
    />
  )

  if (!today || !start) {
    return (
      <main data-testid="screen-history-screen">
        {header}
        <Spinner />
      </main>
    )
  }

  const byDate = new Map<string, HistoryDay>((history.data?.days ?? []).map((d) => [d.date, d]))
  const summary = new Map<string, { name: string; earned: number }>()
  for (const d of history.data?.days ?? []) {
    for (const r of d.routines) {
      const s = summary.get(String(r.routineId)) ?? { name: r.name, earned: 0 }
      if (r.state === 'EARNED' || r.state === 'AWAITING_PICK') s.earned += 1
      summary.set(String(r.routineId), s)
    }
  }
  const refresh = () => void history.refetch()

  return (
    <main data-testid="screen-history-screen">
      {header}
      <div className="mb-4 flex items-center justify-between gap-2">
        <Button variant="secondary" onClick={() => setOffset((o) => o - 1)}>
          Previous week
        </Button>
        <p className="text-center font-bold" aria-live="polite">
          {dayLabel(start)} – {dayLabel(end)}
        </p>
        <Button variant="secondary" disabled={isCurrentWeek} onClick={() => setOffset((o) => o + 1)}>
          Next week
        </Button>
      </div>

      <ul aria-label="Legend" className="mb-4 flex flex-wrap gap-2 text-sm">
        {LEGEND.map((s) => (
          <li key={s}>
            <StateBadge state={s} doneCount={0} taskCount={0} />
          </li>
        ))}
      </ul>

      {history.isPending && <Spinner />}
      {history.isError && <p role="alert">Could not load history.</p>}

      {history.data && (
        <>
          <ol className="grid grid-cols-1 gap-3 md:grid-cols-7">
            {weekDates(start).map((date) => {
              const future = date > today
              const day = byDate.get(date)
              return (
                <li key={date} data-testid={`day-${date}`} className={future ? 'opacity-50' : ''}>
                  <Card className="h-full">
                    {future ? (
                      <p className="font-bold" aria-label={`${dayLabel(date)}, upcoming`}>
                        {dayLabel(date)}
                      </p>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setOpenDate(date)}
                        aria-label={`Open ${dayLabel(date)}`}
                        className="mb-2 min-h-11 w-full rounded-xl text-left font-bold underline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-ink"
                      >
                        {dayLabel(date)}
                      </button>
                    )}
                    {!future && (
                      <ul className="flex flex-col gap-2">
                        {(day?.routines ?? []).map((r) => (
                          <li key={r.routineId} className="flex flex-col gap-1">
                            <span className="text-sm font-semibold">{r.name}</span>
                            <StateBadge state={r.state} doneCount={r.doneCount} taskCount={r.taskCount} />
                            {/* FR-6.11: the day ended before I'm Done! was tapped, so check the tasks were really done. */}
                            {r.autoFinished && (
                              <span data-testid="auto-finished-mark" className="text-xs font-semibold">
                                <span aria-hidden="true">⏰ </span>Finished automatically
                              </span>
                            )}
                          </li>
                        ))}
                        {(day?.revocations ?? []).length > 0 && (
                          <li className="text-sm font-semibold">↩ {day?.revocations.length} removed</li>
                        )}
                        {(day?.routines ?? []).length === 0 && <li className="text-sm">No routines</li>}
                      </ul>
                    )}
                  </Card>
                </li>
              )
            })}
          </ol>
          {history.data.days.length === 0 && <EmptyState icon="📅" title="No history for this week yet" />}
          {summary.size > 0 && (
            <ul aria-label="Week summary" className="mt-4 text-sm">
              {[...summary.values()].map((s) => (
                <li key={s.name}>
                  {s.name}: {s.earned} of {history.data.days.filter((d) => d.date <= today).length} days this week
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {openDate && (
        <DayDetail
          childId={childId}
          childName={child?.name ?? 'Your child'}
          date={openDate}
          onClose={() => {
            setOpenDate(null)
            refresh()
          }}
          onChanged={refresh}
        />
      )}
    </main>
  )
}
