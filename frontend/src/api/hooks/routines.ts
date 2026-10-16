import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { api, unwrap } from '../client'
import type { ApiError } from '../errors'
import { qk } from '../queryKeys'
import type { Routine, RoutineDeleteResult, RoutineInput, RoutineSaveResult } from '../types'

export function useRoutines(childId: number) {
  return useQuery<Routine[], ApiError>({
    queryKey: qk.parent.routines(childId),
    queryFn: () =>
      unwrap<Routine[]>(api.GET('/api/parent/children/{childId}/routines', { params: { path: { childId } } })),
  })
}

export function useRoutine(routineId: number | null) {
  return useQuery<Routine, ApiError>({
    queryKey: qk.parent.routine(routineId ?? -1),
    queryFn: () =>
      unwrap<Routine>(
        api.GET('/api/parent/routines/{routineId}', { params: { path: { routineId: routineId as number } } }),
      ),
    enabled: routineId !== null,
  })
}

function invalidateRoutine(qc: QueryClient, childId: number, routineId?: number) {
  void qc.invalidateQueries({ queryKey: qk.parent.routines(childId) })
  if (routineId !== undefined) void qc.invalidateQueries({ queryKey: qk.parent.routine(routineId) })
  void qc.invalidateQueries({ queryKey: ['chart', childId] })
  void qc.invalidateQueries({ queryKey: ['parent', 'history', childId] })
}

export function useCreateRoutine(childId: number) {
  const qc = useQueryClient()
  return useMutation<RoutineSaveResult, ApiError, RoutineInput>({
    mutationFn: (body) =>
      unwrap<RoutineSaveResult>(
        api.POST('/api/parent/children/{childId}/routines', { params: { path: { childId } }, body }),
      ),
    onSuccess: (result) => {
      invalidateRoutine(qc, childId, result.routine.id)
    },
  })
}

export function useSaveRoutine(routineId: number) {
  const qc = useQueryClient()
  return useMutation<RoutineSaveResult, ApiError, RoutineInput>({
    mutationFn: (body) =>
      unwrap<RoutineSaveResult>(
        api.PUT('/api/parent/routines/{routineId}', { params: { path: { routineId } }, body }),
      ),
    onSuccess: () => {
      // The childId is not part of the mutation variables; refresh all child-scoped lists.
      void qc.invalidateQueries({ queryKey: ['parent', 'routines'] })
      void qc.invalidateQueries({ queryKey: qk.parent.routine(routineId) })
      void qc.invalidateQueries({ queryKey: ['chart'] })
      void qc.invalidateQueries({ queryKey: ['parent', 'history'] })
    },
  })
}

export function useDeleteRoutine(childId: number) {
  const qc = useQueryClient()
  return useMutation<RoutineDeleteResult, ApiError, { routineId: number }>({
    mutationFn: ({ routineId }) =>
      unwrap<RoutineDeleteResult>(
        api.DELETE('/api/parent/routines/{routineId}', { params: { path: { routineId } } }),
      ),
    onSuccess: (_r, { routineId }) => invalidateRoutine(qc, childId, routineId),
  })
}

export function useReorderRoutines(childId: number) {
  const qc = useQueryClient()
  const key = qk.parent.routines(childId)
  return useMutation<void, ApiError, { routineIds: number[] }, { previous: Routine[] | undefined }>({
    mutationFn: ({ routineIds }) =>
      unwrap<void>(
        api.PUT('/api/parent/children/{childId}/routines/order', {
          params: { path: { childId } },
          body: { routineIds },
        }),
      ),
    onMutate: async ({ routineIds }) => {
      await qc.cancelQueries({ queryKey: key })
      const previous = qc.getQueryData<Routine[]>(key)
      if (previous) {
        const byId = new Map(previous.map((r) => [r.id, r]))
        const ordered = routineIds.flatMap((id) => byId.get(id) ?? [])
        const rest = previous.filter((r) => !routineIds.includes(r.id))
        qc.setQueryData<Routine[]>(key, [...ordered, ...rest])
      }
      return { previous }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous)
    },
    onSettled: () => invalidateRoutine(qc, childId),
  })
}

export function useCopyRoutine() {
  const qc = useQueryClient()
  return useMutation<Routine, ApiError, { routineId: number; targetChildId: number }>({
    mutationFn: ({ routineId, targetChildId }) =>
      unwrap<Routine>(
        api.POST('/api/parent/routines/{routineId}/copy', {
          params: { path: { routineId } },
          body: { targetChildId },
        }),
      ),
    onSuccess: (_r, { targetChildId }) => invalidateRoutine(qc, targetChildId),
  })
}

interface SkipVars {
  routineId: number
  childId: number
  date: string
}

export function useSkipRoutine() {
  const qc = useQueryClient()
  return useMutation<void, ApiError, SkipVars>({
    mutationFn: ({ routineId, date }) =>
      unwrap<void>(api.PUT('/api/parent/routines/{routineId}/skips/{date}', { params: { path: { routineId, date } } })),
    onSuccess: (_r, { routineId, childId }) => invalidateRoutine(qc, childId, routineId),
  })
}

export function useUnskipRoutine() {
  const qc = useQueryClient()
  return useMutation<void, ApiError, SkipVars>({
    mutationFn: ({ routineId, date }) =>
      unwrap<void>(
        api.DELETE('/api/parent/routines/{routineId}/skips/{date}', { params: { path: { routineId, date } } }),
      ),
    onSuccess: (_r, { routineId, childId }) => invalidateRoutine(qc, childId, routineId),
  })
}
