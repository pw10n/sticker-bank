import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, unwrap } from '../client'
import type { ApiError } from '../errors'
import { qk } from '../queryKeys'
import type { Bootstrap, DailyChart, TaskToggleResult } from '../types'

type Vars = { taskId: number; note?: string }

/**
 * Parent revokes the sticker of an earned routine by unchecking one of its tasks (TDD 7.11).
 * Not optimistic: the confirm sheet waits for the server.
 */
export function useRevokeSticker(childId: number, date: string) {
  const qc = useQueryClient()
  return useMutation<TaskToggleResult, ApiError, Vars>({
    mutationFn: ({ taskId, note }) =>
      unwrap<TaskToggleResult>(
        api.DELETE('/api/children/{childId}/days/{date}/tasks/{taskId}', {
          params: { path: { childId, date, taskId }, query: { revokeSticker: true } },
          body: note ? { note } : undefined,
        }),
      ),
    onSuccess: (result) => {
      const replace = (old: DailyChart | undefined): DailyChart | undefined =>
        old
          ? { ...old, routines: old.routines.map((r) => (r.routineId === result.routine.routineId ? result.routine : r)) }
          : old
      qc.setQueryData<DailyChart>(qk.chart(childId, date), replace)
      const today = qc.getQueryData<Bootstrap>(qk.bootstrap())?.today
      if (today && today === date) qc.setQueryData<DailyChart>(qk.chart(childId, 'today'), replace)
      for (const queryKey of [
        ['chart', childId],
        ['book', childId],
        ['parent', 'history', childId],
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
