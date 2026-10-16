import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { api, unwrap } from '../client'
import type { ApiError } from '../errors'
import { qk } from '../queryKeys'
import type { PendingPrizeRequest, PrizeRequest } from '../types'

export function usePendingPrizeRequest(childId: number) {
  return useQuery({
    queryKey: qk.pendingRequest(childId),
    queryFn: async (): Promise<PrizeRequest | null> => {
      const r = await unwrap<PendingPrizeRequest>(
        api.GET('/api/children/{childId}/prize-requests/pending', { params: { path: { childId } } }),
      )
      return r.request ?? null
    },
    refetchInterval: 15_000,
  })
}

function invalidateAfterRequest(qc: QueryClient, childId: number) {
  void qc.invalidateQueries({ queryKey: ['book', childId] })
  void qc.invalidateQueries({ queryKey: qk.bootstrap() })
  void qc.invalidateQueries({ queryKey: ['parent', 'prizeRequests'] })
}

export function useCreatePrizeRequest(childId: number) {
  const qc = useQueryClient()
  return useMutation<PrizeRequest, ApiError, { stickerIds: number[] }>({
    mutationFn: ({ stickerIds }) =>
      unwrap<PrizeRequest>(
        api.POST('/api/children/{childId}/prize-requests', { params: { path: { childId } }, body: { stickerIds } }),
      ),
    onSuccess: (result) => {
      qc.setQueryData<PrizeRequest | null>(qk.pendingRequest(childId), result)
      invalidateAfterRequest(qc, childId)
    },
  })
}

export function useCancelPrizeRequest(childId: number) {
  const qc = useQueryClient()
  return useMutation<PrizeRequest, ApiError, { requestId: number }>({
    mutationFn: ({ requestId }) =>
      unwrap<PrizeRequest>(api.POST('/api/prize-requests/{requestId}/cancel', { params: { path: { requestId } } })),
    onSuccess: () => {
      qc.setQueryData<PrizeRequest | null>(qk.pendingRequest(childId), null)
      invalidateAfterRequest(qc, childId)
    },
  })
}
