import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useBootstrap, useDailyChart, useFinishRoutine, useToggleTask } from '../../api/hooks'
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
  const finish = useFinishRoutine(childId, 'today')
  const canWrite = useCanWrite()
  const { play } = useSound()
  const { setCelebrating } = useCelebrationGuard()
  const [pending, setPending] = useState<ReadonlySet<number>>(new Set())
  const [finishingId, setFinishingId] = useState<number | null>(null)
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
  // A routine that is Ready to finish is not finished yet, so it keeps the focus and its button stays in view.
  const focusId =
    visible.find((r) => r.state === 'NOT_STARTED' || r.state === 'IN_PROGRESS' || r.state === 'READY_TO_FINISH')?.routineId ?? null

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
        await toggle.mutateAsync({ taskId, date: chart.date, done })
        // Checking the last task only gets this small pop. The big celebration waits for I'm Done! (FR-7.2).
        if (done) {
          play('pop')
          celebrateTask(tileEl)
        }
      } catch (e) {
        if (!isApiError(e, 'DAY_CHANGED')) play('error')
      } finally {
        if (mounted.current) setPendingId(taskId, false)
      }
    },
    [chart, toggle, play],
  )

  const onFinish = useCallback(
    async (routine: ChartRoutine) => {
      if (!chart || finishingId !== null) return
      setFinishingId(routine.routineId)
      try {
        const result = await finish.mutateAsync({ routineId: routine.routineId, date: chart.date })
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
        // A new day (the sticker is waiting in the tray) or a task unchecked elsewhere just reloads the chart.
        if (!isApiError(e, 'DAY_CHANGED') && !isApiError(e, 'ROUTINE_NOT_READY')) play('error')
      } finally {
        if (mounted.current) setFinishingId(null)
      }
    },
    [chart, finishingId, finish, play, setCelebrating, navigate, childId],
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
              finishing={finishingId === r.routineId}
              onToggle={onToggle}
              onFinish={onFinish}
              cardRef={r.routineId === focusId ? focusRef : undefined}
            />
          ))}
        </div>
      )}
    </main>
  )
}
