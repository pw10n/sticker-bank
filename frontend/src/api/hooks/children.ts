import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, unwrap } from '../client'
import type { ApiError } from '../errors'
import { qk } from '../queryKeys'
import type { Child, ChildInput } from '../types'

export function useChildren() {
  return useQuery<Child[], ApiError>({
    queryKey: qk.parent.children(),
    queryFn: () => unwrap<Child[]>(api.GET('/api/parent/children')),
  })
}

export function useCreateChild() {
  const qc = useQueryClient()
  return useMutation<Child, ApiError, ChildInput>({
    mutationFn: (body) => unwrap<Child>(api.POST('/api/parent/children', { body })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.parent.children() })
      void qc.invalidateQueries({ queryKey: qk.bootstrap() })
    },
  })
}

export function useUpdateChild(childId: number) {
  const qc = useQueryClient()
  return useMutation<Child, ApiError, ChildInput>({
    mutationFn: (body) =>
      unwrap<Child>(api.PUT('/api/parent/children/{childId}', { params: { path: { childId } }, body })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.parent.children() })
      void qc.invalidateQueries({ queryKey: qk.bootstrap() })
    },
  })
}

export function useDeleteChild() {
  const qc = useQueryClient()
  return useMutation<void, ApiError, { childId: number }>({
    mutationFn: ({ childId }) =>
      unwrap<void>(api.DELETE('/api/parent/children/{childId}', { params: { path: { childId } } })),
    onSuccess: (_r, { childId }) => {
      qc.removeQueries({ queryKey: ['chart', childId] })
      qc.removeQueries({ queryKey: ['book', childId] })
      qc.removeQueries({ queryKey: qk.pendingRequest(childId) })
      void qc.invalidateQueries({ queryKey: qk.parent.children() })
      void qc.invalidateQueries({ queryKey: qk.bootstrap() })
    },
  })
}
