import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useBootstrap, useDailyChart, useToggleTask } from '../../api/hooks'
import { isApiError } from '../../api/errors'
import type { ChartRoutine } from '../../api/types'
import { useCanWrite, useCelebrationGuard } from '../../app'
import { celebrateRoutine, celebrateTask, EmptyState, Spinner } from '../../ui'
import { useSound } from '../../sound'
import { RoutineCard } from './RoutineCard'
import { UnclaimedTray } from './UnclaimedTray'

export default function DailyChartScreen() {
  const childId = Number(useParams().childId)
  const navigate = useNavigate()
  const bootstrap = useBootstrap()
  const chartQuery = useDailyChart(childId, 'today')
  const toggle = useToggleTask(childId, 'today')
  const canWrite = useCanWrite()
  const { play } = useSound()
  const { setCelebrating } = useCelebrationGuard()
  const [pending, setPending] = useState<ReadonlySet<number>>(new Set())
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const chart = chartQuery.data
  const childColor = bootstrap.data?.children.find((c) => c.id === childId)?.themeColor ?? '#FFB703'
  const visible = useMemo(() => (chart?.routines ?? []).filter((r) => r.state !== 'SKIPPED'), [chart])
  const focusId = visible.find((r) => r.state === 'NOT_STARTED' || r.state === 'IN_PROGRESS')?.routineId ?? null

  const focusRef = useRef<HTMLElement | null>(null)
  const scrolled = useRef(false)
  useEffect(() => {
    if (focusId === null || scrolled.current) return
    scrolled.current = true
    const el = focusRef.current
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [focusId])

  const setPendingId = (id: number, on: boolean) =>
    setPending((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  const onToggle = useCallback(
    async (_routine: ChartRoutine, taskId: number, done: boolean, tileEl: HTMLElement | null) => {
      if (!chart) return
      setPendingId(taskId, true)
      try {
        const result = await toggle.mutateAsync({ taskId, date: chart.date, done })
        if (done) {
          play('pop')
          celebrateTask(tileEl)
        }
        if (result.pick) {
          const stickerId = result.pick.stickerId
          setCelebrating(true)
          try {
            play('fanfare')
            await celebrateRoutine()
          } finally {
            setCelebrating(false)
          }
          navigate(`/c/${childId}/pick/${stickerId}`)
        }
      } catch (e) {
        if (!isApiError(e, 'DAY_CHANGED')) play('error')
      } finally {
        if (mounted.current) setPendingId(taskId, false)
      }
    },
    [chart, toggle, play, setCelebrating, navigate, childId],
  )

  if (chartQuery.isPending) {
    return (
      <main className="flex min-h-[60dvh] items-center justify-center" aria-busy="true">
        <Spinner />
      </main>
    )
  }
  if (!chart) {
    return (
      <main className="p-6">
        <EmptyState icon="☁️" title="Waiting for Wi-Fi…" message="We will be right back!" />
      </main>
    )
  }

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-6 p-4 sm:p-6" style={{ touchAction: 'manipulation' }}>
      <UnclaimedTray items={chart.unclaimedFromEarlierDays} childId={childId} today={chart.date} />
      {visible.length === 0 ? (
        <EmptyState icon="🎈" title="No routines today — time to play! 🎈" />
      ) : (
        <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((r) => (
            <RoutineCard
              key={r.routineId}
              routine={r}
              childId={childId}
              childColor={childColor}
              highlighted={r.routineId === focusId}
              canWrite={canWrite}
              pendingTaskIds={pending}
              onToggle={onToggle}
              cardRef={r.routineId === focusId ? focusRef : undefined}
            />
          ))}
        </div>
      )}
    </main>
  )
}
