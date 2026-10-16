import { useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, unwrap } from '../client'
import { isApiError, type ApiError } from '../errors'
import { qk } from '../queryKeys'
import type { ChartRoutine, DailyChart, TaskToggleResult } from '../types'

export function useDailyChart(
  childId: number,
  date: string,
  opts?: { poll?: boolean; enabled?: boolean },
) {
  const poll = date === 'today' && opts?.poll !== false
  return useQuery({
    queryKey: qk.chart(childId, date),
    queryFn: () =>
      unwrap<DailyChart>(api.GET('/api/children/{childId}/days/{date}', { params: { path: { childId, date } } })),
    enabled: opts?.enabled ?? true,
    refetchInterval: poll ? 30_000 : false,
  })
}

interface ToggleVars {
  taskId: number
  date: string
  done: boolean
}

/** Applies a single task's done flag to the chart (no-op when already in that state). */
function applyToggle(chart: DailyChart, taskId: number, done: boolean): DailyChart {
  return {
    ...chart,
    routines: chart.routines.map((r) => {
      const task = r.tasks.find((t) => t.taskId === taskId)
      if (!task || task.done === done) return r
      const doneCount = Math.max(0, Math.min(r.taskCount, r.doneCount + (done ? 1 : -1)))
      let state = r.state
      // Checking the last task stays IN_PROGRESS until the server says READY_TO_FINISH (the I'm Done! button follows
      // the server). Unchecking a task of a Ready-to-finish routine puts it straight back in progress (FR-6.7).
      if (state === 'NOT_STARTED' || state === 'IN_PROGRESS' || state === 'READY_TO_FINISH') {
        state = doneCount > 0 ? 'IN_PROGRESS' : 'NOT_STARTED'
      }
      return {
        ...r,
        doneCount,
        state,
        tasks: r.tasks.map((t) => (t.taskId === taskId ? { ...t, done } : t)),
      }
    }),
  }
}

export function useToggleTask(childId: number, chartKeyDate: string) {
  const qc = useQueryClient()
  const key = qk.chart(childId, chartKeyDate)
  const latestSeq = useRef(0)
  const mutationKey = ['toggleTask', childId, chartKeyDate] as const
  // The settling mutation is still counted as mutating inside its own callbacks.
  const isLastInFlight = () => qc.isMutating({ mutationKey }) <= 1
  return useMutation<TaskToggleResult, ApiError, ToggleVars, { previous: DailyChart | undefined; seq: number }>({
    mutationKey,
    mutationFn: ({ taskId, date, done }) => {
      const params = { params: { path: { childId, date, taskId } } }
      return unwrap<TaskToggleResult>(
        done
          ? api.PUT('/api/children/{childId}/days/{date}/tasks/{taskId}', params)
          : api.DELETE('/api/children/{childId}/days/{date}/tasks/{taskId}', params),
      )
    },
    onMutate: async ({ taskId, done }) => {
      const seq = ++latestSeq.current
      await qc.cancelQueries({ queryKey: key })
      const previous = qc.getQueryData<DailyChart>(key)
      if (previous) qc.setQueryData<DailyChart>(key, applyToggle(previous, taskId, done))
      return { previous, seq }
    },
    onError: (error, { taskId, done }, ctx) => {
      if (isLastInFlight()) {
        if (ctx?.previous) qc.setQueryData(key, ctx.previous)
      } else {
        // Other optimistic toggles are in flight: undo only this task.
        qc.setQueryData<DailyChart>(key, (old) => (old ? applyToggle(old, taskId, !done) : old))
      }
      if (isApiError(error, 'DAY_CHANGED')) {
        void qc.invalidateQueries({ queryKey: qk.bootstrap() })
        void qc.invalidateQueries({ queryKey: ['chart', childId] })
      }
    },
    onSuccess: (result, _vars, ctx) => {
      // A parent fixing a past day must refresh any history view of this child.
      void qc.invalidateQueries({ queryKey: ['parent', 'history', childId] })
      // Only the last in-flight response of the most recently issued toggle may
      // write the routine; others may be stale relative to later optimistic taps.
      if (isLastInFlight() && (ctx === undefined || ctx.seq === latestSeq.current)) {
        qc.setQueryData<DailyChart>(key, (old) =>
          old
            ? {
                ...old,
                routines: old.routines.map((r: ChartRoutine) =>
                  r.routineId === result.routine.routineId ? result.routine : r,
                ),
              }
            : old,
        )
      }
    },
    onSettled: (_data, error) => {
      // A dead network cannot reconcile anything; the app refetches on reconnect.
      if (isApiError(error, 'NETWORK')) return
      if (isLastInFlight()) void qc.invalidateQueries({ queryKey: key })
    },
  })
}

interface FinishVars {
  routineId: number
  date: string
}

/**
 * I'm Done! (FR-6.8): finishes a routine whose tasks are all done. This is the only call that earns a sticker from the
 * app besides the day ending, so checking the last task never does (FR-7.1). The response carries the saved pick.
 */
export function useFinishRoutine(childId: number, chartKeyDate: string) {
  const qc = useQueryClient()
  const key = qk.chart(childId, chartKeyDate)
  return useMutation<TaskToggleResult, ApiError, FinishVars>({
    mutationKey: ['finishRoutine', childId, chartKeyDate],
    mutationFn: ({ routineId, date }) =>
      unwrap<TaskToggleResult>(
        api.POST('/api/children/{childId}/days/{date}/routines/{routineId}/finish', {
          params: { path: { childId, date, routineId } },
        }),
      ),
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: ['parent', 'history', childId] })
      qc.setQueryData<DailyChart>(key, (old) =>
        old
          ? {
              ...old,
              routines: old.routines.map((r: ChartRoutine) =>
                r.routineId === result.routine.routineId ? result.routine : r,
              ),
            }
          : old,
      )
      if (result.pick) {
        qc.setQueryData(qk.pick(result.pick.stickerId), result.pick)
        void qc.invalidateQueries({ queryKey: ['book', childId] })
      }
    },
    onError: (error) => {
      // A new day started (the sticker is waiting in the tray), or another device unchecked a task: just reload.
      if (isApiError(error, 'DAY_CHANGED')) {
        void qc.invalidateQueries({ queryKey: qk.bootstrap() })
        void qc.invalidateQueries({ queryKey: ['chart', childId] })
      } else if (isApiError(error, 'ROUTINE_NOT_READY')) {
        void qc.invalidateQueries({ queryKey: key })
      }
    },
  })
}
