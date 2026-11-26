import { useRef } from 'react'
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import { api, unwrap } from '../client'
import { isApiError, type ApiError } from '../errors'
import { qk } from '../queryKeys'
import type { ChartChore, Chore, ChoreInput, ChorePage, ChoreResult, ChoreSuggestion, DailyChart } from '../types'

// Chore ids and routine ids are separate id spaces (and so are their task ids): chores are only ever looked up in
// `chart.chores`, routines only in `chart.routines`.

/** Every unfinished chore (unpaged). Pass childId to narrow to one child. */
export function useActiveChores(opts?: { childId?: number }) {
  const childId = opts?.childId
  return useQuery<Chore[], ApiError>({
    queryKey: qk.parent.chores({ filter: 'active', childId }),
    queryFn: async () =>
      (
        await unwrap<ChorePage>(
          api.GET('/api/parent/chores', { params: { query: { filter: 'active', childId } } }),
        )
      ).items,
  })
}

/** Finished chores, and missed ones of the last 30 days, in pages. */
export function useClosedChores(opts?: { childId?: number }) {
  const childId = opts?.childId
  return useInfiniteQuery({
    queryKey: qk.parent.chores({ filter: 'closed', childId }),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      unwrap<ChorePage>(
        api.GET('/api/parent/chores', { params: { query: { filter: 'closed', childId, cursor: pageParam } } }),
      ),
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  })
}

/** Recently used chores, for the "start from a past chore" suggestions. */
export function useRecentChores() {
  return useQuery<ChoreSuggestion[], ApiError>({
    queryKey: qk.parent.recentChores(),
    queryFn: () => unwrap<ChoreSuggestion[]>(api.GET('/api/parent/chores/recent')),
  })
}

function invalidateParentChores(qc: QueryClient, childId: number) {
  void qc.invalidateQueries({ queryKey: ['parent', 'chores'] })
  void qc.invalidateQueries({ queryKey: ['chart', childId] })
}

export function useAssignChore() {
  const qc = useQueryClient()
  return useMutation<Chore, ApiError, { childId: number; input: ChoreInput }>({
    mutationFn: ({ childId, input }) =>
      unwrap<Chore>(api.POST('/api/parent/children/{childId}/chores', { params: { path: { childId } }, body: input })),
    onSuccess: (_chore, { childId, input }) => {
      invalidateParentChores(qc, childId)
      if (input.alreadyDone) {
        void qc.invalidateQueries({ queryKey: ['book', childId] })
        void qc.invalidateQueries({ queryKey: ['parent', 'history', childId] })
      }
    },
  })
}

export function useSaveChore() {
  const qc = useQueryClient()
  return useMutation<Chore, ApiError, { choreId: number; childId: number; input: ChoreInput }>({
    mutationFn: ({ choreId, input }) =>
      unwrap<Chore>(api.PUT('/api/parent/chores/{choreId}', { params: { path: { choreId } }, body: input })),
    onSuccess: (_chore, { childId }) => invalidateParentChores(qc, childId),
  })
}

export function useRemoveChore() {
  const qc = useQueryClient()
  return useMutation<void, ApiError, { choreId: number; childId: number }>({
    mutationFn: async ({ choreId }) => {
      await unwrap<unknown>(api.DELETE('/api/parent/chores/{choreId}', { params: { path: { choreId } } }))
    },
    onSuccess: (_r, { childId }) => invalidateParentChores(qc, childId),
  })
}

interface ToggleChoreVars {
  choreId: number
  taskId: number
  done: boolean
}

/** Applies one chore task's done flag to the chart. It never sets READY_TO_FINISH: the server decides that. */
function applyChoreToggle(chart: DailyChart, choreId: number, taskId: number, done: boolean): DailyChart {
  return {
    ...chart,
    chores: chart.chores.map((c) => {
      if (c.choreId !== choreId) return c
      const task = c.tasks.find((t) => t.taskId === taskId)
      if (!task || task.done === done) return c
      const doneCount = Math.max(0, Math.min(c.taskCount, c.doneCount + (done ? 1 : -1)))
      let state = c.state
      if (state === 'NOT_STARTED' || state === 'IN_PROGRESS' || state === 'READY_TO_FINISH') {
        state = doneCount > 0 ? 'IN_PROGRESS' : 'NOT_STARTED'
      }
      return { ...c, doneCount, state, tasks: c.tasks.map((t) => (t.taskId === taskId ? { ...t, done } : t)) }
    }),
  }
}

function replaceChore(chart: DailyChart | undefined, chore: ChartChore | null): DailyChart | undefined {
  if (!chart || !chore) return chart
  return { ...chart, chores: chart.chores.map((c) => (c.choreId === chore.choreId ? chore : c)) }
}

export function useToggleChoreTask(childId: number, chartKeyDate: string) {
  const qc = useQueryClient()
  const key = qk.chart(childId, chartKeyDate)
  const latestSeq = useRef(0)
  const mutationKey = ['toggleChoreTask', childId, chartKeyDate] as const
  // The settling mutation is still counted as mutating inside its own callbacks.
  const isLastInFlight = () => qc.isMutating({ mutationKey }) <= 1
  return useMutation<ChoreResult, ApiError, ToggleChoreVars, { previous: DailyChart | undefined; seq: number }>({
    mutationKey,
    mutationFn: ({ choreId, taskId, done }) => {
      const params = { params: { path: { childId, choreId, taskId } } }
      return unwrap<ChoreResult>(
        done
          ? api.PUT('/api/children/{childId}/chores/{choreId}/tasks/{taskId}', params)
          : api.DELETE('/api/children/{childId}/chores/{choreId}/tasks/{taskId}', params),
      )
    },
    onMutate: async ({ choreId, taskId, done }) => {
      const seq = ++latestSeq.current
      await qc.cancelQueries({ queryKey: key })
      const previous = qc.getQueryData<DailyChart>(key)
      if (previous) qc.setQueryData<DailyChart>(key, applyChoreToggle(previous, choreId, taskId, done))
      return { previous, seq }
    },
    onError: (_error, { choreId, taskId, done }, ctx) => {
      if (isLastInFlight()) {
        if (ctx?.previous) qc.setQueryData(key, ctx.previous)
      } else {
        // Other optimistic toggles are in flight: undo only this task.
        qc.setQueryData<DailyChart>(key, (old) => (old ? applyChoreToggle(old, choreId, taskId, !done) : old))
      }
    },
    onSuccess: (result, _vars, ctx) => {
      void qc.invalidateQueries({ queryKey: ['parent', 'chores'] })
      void qc.invalidateQueries({ queryKey: ['parent', 'history', childId] })
      // Only the last in-flight response of the most recently issued toggle may write the chore.
      if (isLastInFlight() && (ctx === undefined || ctx.seq === latestSeq.current)) {
        qc.setQueryData<DailyChart>(key, (old) => replaceChore(old, result.chore))
      }
    },
    onSettled: (_data, error) => {
      // A dead network cannot reconcile anything; the app refetches on reconnect.
      if (isApiError(error, 'NETWORK')) return
      if (isLastInFlight()) void qc.invalidateQueries({ queryKey: key })
    },
  })
}

/** I'm Done! for a chore. The response carries the saved pick. */
export function useFinishChore(childId: number, chartKeyDate: string) {
  const qc = useQueryClient()
  const key = qk.chart(childId, chartKeyDate)
  return useMutation<ChoreResult, ApiError, { choreId: number }>({
    mutationKey: ['finishChore', childId, chartKeyDate],
    mutationFn: ({ choreId }) =>
      unwrap<ChoreResult>(
        api.POST('/api/children/{childId}/chores/{choreId}/finish', { params: { path: { childId, choreId } } }),
      ),
    onSuccess: (result) => {
      qc.setQueryData<DailyChart>(key, (old) => replaceChore(old, result.chore))
      if (result.pick) qc.setQueryData(qk.pick(result.pick.stickerId), result.pick)
      void qc.invalidateQueries({ queryKey: ['book', childId] })
      void qc.invalidateQueries({ queryKey: ['parent', 'chores'] })
      void qc.invalidateQueries({ queryKey: ['parent', 'history', childId] })
    },
    onError: (error) => {
      const quiet: string[] = ['CHORE_NOT_READY', 'CHORE_MISSED', 'CHORE_LOCKED']
      if (quiet.includes(error.code) || error.status === 404) {
        void qc.invalidateQueries({ queryKey: key })
      }
    },
  })
}

interface RevokeChoreVars {
  choreId: number
  taskId: number
  note?: string
  removeChore?: boolean
}

/** Parent revokes the sticker of an earned chore by unchecking one of its tasks. Not optimistic. */
export function useRevokeChoreSticker(childId: number) {
  const qc = useQueryClient()
  return useMutation<ChoreResult, ApiError, RevokeChoreVars>({
    mutationFn: async ({ choreId, taskId, note, removeChore }) => {
      try {
        return await unwrap<ChoreResult>(
          api.DELETE('/api/children/{childId}/chores/{choreId}/tasks/{taskId}', {
            params: {
              path: { childId, choreId, taskId },
              query: { revokeSticker: true, ...(removeChore ? { removeChore: true } : {}) },
            },
            body: note ? { note } : undefined,
          }),
        )
      } catch (e) {
        // A repeat of a call that already removed the chore: the goal is reached.
        if (removeChore && isApiError(e) && e.status === 404) return { chore: null, pick: null, revoked: null }
        throw e
      }
    },
    onSuccess: (result, { choreId, removeChore }) => {
      const update = (old: DailyChart | undefined): DailyChart | undefined => {
        if (!old) return old
        if (result.chore) return replaceChore(old, result.chore)
        return removeChore ? { ...old, chores: old.chores.filter((c) => c.choreId !== choreId) } : old
      }
      qc.setQueriesData<DailyChart>({ queryKey: ['chart', childId] }, update)
      for (const queryKey of [
        ['chart', childId],
        ['book', childId],
        ['parent', 'history', childId],
        ['parent', 'chores'],
        qk.bootstrap(),
        ['parent', 'prizeRequests'],
        ['pendingRequest', childId],
        ['pick'],
        ['sticker'],
      ]) {
        void qc.invalidateQueries({ queryKey })
      }
    },
  })
}
