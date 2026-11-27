import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import {
  useBootstrap,
  useDailyChart,
  useFinishChore,
  useFinishRoutine,
  useToggleChoreTask,
  useToggleTask,
} from '../../api/hooks'
import { isApiError } from '../../api/errors'
import type { ChartChore } from '../../api/types'
import { useCanWrite, useCelebrationGuard, useDeviceSettings } from '../../app'
import { celebrateRoutine, celebrateTask, EmptyState, Spinner } from '../../ui'
import { useSound } from '../../sound'
import { NewChoreToast, type ToastChore } from './NewChoreToast'
import { RoutineCard, type CardItem } from './RoutineCard'
import { UnclaimedTray } from './UnclaimedTray'

type Kind = 'routine' | 'chore'
const keyOf = (kind: Kind, id: number) => `${kind}:${id}`
const UNFINISHED_CHORE = new Set<string>(['NOT_STARTED', 'IN_PROGRESS', 'READY_TO_FINISH'])
const QUIET_CHORE_CODES = new Set<string>(['CHORE_NOT_READY', 'CHORE_MISSED', 'CHORE_LOCKED'])
const TOAST_MS = 8000

/** A parent removed the chore, or finished it, since the last poll: the chart just reloads. */
function isQuietChoreError(e: unknown): boolean {
  return isApiError(e) && (QUIET_CHORE_CODES.has(e.code) || e.status === 404)
}

export default function DailyChartScreen() {
  const childId = Number(useParams().childId)
  const navigate = useNavigate()
  const bootstrap = useBootstrap()
  const chartQuery = useDailyChart(childId, 'today')
  const toggle = useToggleTask(childId, 'today')
  const finish = useFinishRoutine(childId, 'today')
  const toggleChore = useToggleChoreTask(childId, 'today')
  const finishChore = useFinishChore(childId, 'today')
  const canWrite = useCanWrite()
  const { play } = useSound()
  const { setCelebrating: guardCelebrating } = useCelebrationGuard()
  const { announcedChoreIds, markChoresAnnounced } = useDeviceSettings()
  // Task and routine/chore ids are separate id spaces, so everything in flight is keyed by kind and id.
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set())
  const [finishingKey, setFinishingKey] = useState<string | null>(null)
  const [celebrating, setCelebratingState] = useState(false)
  // The toast belongs to one child: the screen instance is reused when the child is switched.
  const [toastState, setToastState] = useState<{ childId: number; chores: ToastChore[] }>({ childId, chores: [] })
  const toast = useMemo(() => (toastState.childId === childId ? toastState.chores : []), [toastState, childId])
  const finishingRef = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      guardCelebrating(false)
    }
  }, [guardCelebrating])

  const setCelebrating = useCallback(
    (active: boolean) => {
      guardCelebrating(active)
      if (mounted.current) setCelebratingState(active)
    },
    [guardCelebrating],
  )

  const chart = chartQuery.data
  const childColor = bootstrap.data?.children.find((c) => c.id === childId)?.themeColor ?? '#FFB703'
  const visible = useMemo(() => (chart?.routines ?? []).filter((r) => r.state !== 'SKIPPED'), [chart])
  const chores = useMemo(() => chart?.chores ?? [], [chart])
  // A routine that is Ready to finish is not finished yet, so it keeps the focus and its button stays in view.
  // Chores take no part in the focus rule.
  const focusKey = (() => {
    const r = visible.find((x) => x.state === 'NOT_STARTED' || x.state === 'IN_PROGRESS' || x.state === 'READY_TO_FINISH')
    return r ? keyOf('routine', r.routineId) : null
  })()

  const focusRef = useRef<HTMLElement | null>(null)
  const scrolled = useRef(false)
  useEffect(() => {
    if (focusKey === null || scrolled.current) return
    scrolled.current = true
    const el = focusRef.current
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [focusKey])

  const pendingRoutineTasks = useMemo(() => pendingIds(pending, 'routine'), [pending])
  const pendingChoreTasks = useMemo(() => pendingIds(pending, 'chore'), [pending])

  const setPendingKey = (key: string, on: boolean) =>
    setPending((prev) => {
      const next = new Set(prev)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })

  const onToggle = useCallback(
    async (_routine: CardItem, taskId: number, done: boolean, tileEl: HTMLElement | null) => {
      if (!chart) return
      const key = keyOf('routine', taskId)
      setPendingKey(key, true)
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
        if (mounted.current) setPendingKey(key, false)
      }
    },
    [chart, toggle, play],
  )

  const onToggleChore = useCallback(
    async (chore: CardItem, taskId: number, done: boolean, tileEl: HTMLElement | null) => {
      if (!chart || !('choreId' in chore)) return
      const key = keyOf('chore', taskId)
      setPendingKey(key, true)
      try {
        await toggleChore.mutateAsync({ choreId: chore.choreId, taskId, done })
        if (done) {
          play('pop')
          celebrateTask(tileEl)
        }
      } catch (e) {
        if (!isQuietChoreError(e)) play('error')
      } finally {
        if (mounted.current) setPendingKey(key, false)
      }
    },
    [chart, toggleChore, play],
  )

  const celebrate = useCallback(
    async (stickerId: number) => {
      setCelebrating(true)
      let leaving = false
      try {
        play('fanfare')
        await celebrateRoutine()
        // Leaving for the pick: the flag stays on until this screen unmounts, so nothing is announced on the way out.
        leaving = true
        navigate(`/c/${childId}/pick/${stickerId}`)
      } finally {
        if (!leaving) setCelebrating(false)
      }
    },
    [setCelebrating, play, navigate, childId],
  )

  const onFinish = useCallback(
    async (routine: CardItem) => {
      if (!chart || finishingRef.current || !('routineId' in routine)) return
      finishingRef.current = true
      setFinishingKey(keyOf('routine', routine.routineId))
      try {
        const result = await finish.mutateAsync({ routineId: routine.routineId, date: chart.date })
        if (result.pick) await celebrate(result.pick.stickerId)
      } catch (e) {
        // A new day (the sticker is waiting in the tray) or a task unchecked elsewhere just reloads the chart.
        if (!isApiError(e, 'DAY_CHANGED') && !isApiError(e, 'ROUTINE_NOT_READY')) play('error')
      } finally {
        finishingRef.current = false
        if (mounted.current) setFinishingKey(null)
      }
    },
    [chart, finish, play, celebrate],
  )

  const onFinishChore = useCallback(
    async (chore: CardItem) => {
      if (!chart || finishingRef.current || !('choreId' in chore)) return
      finishingRef.current = true
      setFinishingKey(keyOf('chore', chore.choreId))
      try {
        const result = await finishChore.mutateAsync({ choreId: chore.choreId })
        if (result.pick) await celebrate(result.pick.stickerId)
      } catch (e) {
        if (!isQuietChoreError(e)) play('error')
      } finally {
        finishingRef.current = false
        if (mounted.current) setFinishingKey(null)
      }
    },
    [chart, finishChore, play, celebrate],
  )

  // New chore (FR-13.14): a chart load or a poll that brings an unfinished chore this device has not announced yet.
  const announced = announcedChoreIds(childId)
  const handled = useRef<{ childId: number; ids: Set<number> }>({ childId, ids: new Set() })
  useEffect(() => {
    if (!chart || celebrating) return
    if (handled.current.childId !== childId) handled.current = { childId, ids: new Set() }
    const seen = handled.current.ids
    const onChart = chart.chores.map((c) => c.choreId)
    const fresh = chart.chores.filter(
      (c) => UNFINISHED_CHORE.has(c.state) && !announced.includes(c.choreId) && !seen.has(c.choreId),
    )
    if (fresh.length > 0) {
      fresh.forEach((c) => seen.add(c.choreId))
      play('chime')
      setToastState((prev) => ({
        childId,
        chores: [
          ...(prev.childId === childId ? prev.chores : []).filter((p) => !fresh.some((f) => f.choreId === p.choreId)),
          ...fresh.map((c) => ({ choreId: c.choreId, name: c.name, iconKey: c.iconKey })),
        ],
      }))
      markChoresAnnounced(childId, fresh.map((c) => c.choreId), onChart)
    } else if (announced.some((id) => !onChart.includes(id))) {
      markChoresAnnounced(childId, [], onChart)
    }
  }, [chart, celebrating, announced, childId, play, markChoresAnnounced])

  useEffect(() => {
    if (toast.length === 0) return
    const timer = setTimeout(() => setToastState({ childId, chores: [] }), TOAST_MS)
    return () => clearTimeout(timer)
  }, [toast, childId])

  const choreEls = useRef(new Map<number, HTMLElement>())
  const onToastPress = () => {
    const first = toast[0]
    setToastState({ childId, chores: [] })
    const el = first ? choreEls.current.get(first.choreId) : undefined
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

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

  // Routine cards are 23rem wide at minimum and grow to 28rem: 1 column below 760px of content, 2 from 760px, 3 from 1152px;
  // a lone last card centres under the row above. Chores use the same widths and gap, in a group below.
  const cardBox = 'min-w-[min(100%,23rem)] max-w-[28rem] grow basis-[23rem]'
  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-6 p-4 sm:p-6" style={{ touchAction: 'manipulation' }}>
      <UnclaimedTray items={chart.unclaimedFromEarlierDays} childId={childId} today={chart.date} />
      {visible.length === 0 && chores.length === 0 ? (
        <EmptyState icon="🎈" title="No routines today — time to play! 🎈" />
      ) : (
        <>
          {visible.length > 0 && (
            <div className="flex flex-wrap items-start justify-center gap-6">
              {visible.map((r) => {
                const key = keyOf('routine', r.routineId)
                return (
                  <div key={key} className={cardBox}>
                    <RoutineCard
                      routine={r}
                      childId={childId}
                      childColor={childColor}
                      highlighted={key === focusKey}
                      canWrite={canWrite}
                      pendingTaskIds={pendingRoutineTasks}
                      finishing={finishingKey === key}
                      onToggle={onToggle}
                      onFinish={onFinish}
                      cardRef={key === focusKey ? focusRef : undefined}
                    />
                  </div>
                )
              })}
            </div>
          )}
          {chores.length > 0 && (
            <section aria-labelledby="chores-heading" data-testid="chores-group" className="flex flex-col gap-4">
              <h2 id="chores-heading" className="flex items-center justify-center gap-2 text-xl font-bold">
                <span aria-hidden="true">🧹</span>
                <span>Chores</span>
              </h2>
              <div className="flex flex-wrap items-start justify-center gap-6">
                {chores.map((c: ChartChore) => {
                  const key = keyOf('chore', c.choreId)
                  return (
                    <div key={key} className={cardBox}>
                      <RoutineCard
                        routine={c}
                        kind="chore"
                        today={chart.date}
                        childId={childId}
                        childColor={childColor}
                        highlighted={false}
                        canWrite={canWrite}
                        pendingTaskIds={pendingChoreTasks}
                        finishing={finishingKey === key}
                        onToggle={onToggleChore}
                        onFinish={onFinishChore}
                        cardRef={(el) => {
                          if (el) choreEls.current.set(c.choreId, el)
                          else choreEls.current.delete(c.choreId)
                        }}
                      />
                    </div>
                  )
                })}
              </div>
            </section>
          )}
        </>
      )}
      <NewChoreToast chores={celebrating ? [] : toast} onPress={onToastPress} />
    </main>
  )
}

function pendingIds(pending: ReadonlySet<string>, kind: Kind): ReadonlySet<number> {
  const prefix = `${kind}:`
  const out = new Set<number>()
  for (const k of pending) if (k.startsWith(prefix)) out.add(Number(k.slice(prefix.length)))
  return out
}
