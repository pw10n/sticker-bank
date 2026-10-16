import { useInfiniteQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { api, unwrap } from '../client'
import type { ApiError } from '../errors'
import { qk } from '../queryKeys'
import type { PrizeRequest, PrizeRequestPage, PrizeRequestStatus } from '../types'

export function useParentPrizeRequests(filters: { status?: PrizeRequestStatus[]; childId?: number }) {
  return useInfiniteQuery({
    queryKey: qk.parent.prizeRequests(filters),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      unwrap<PrizeRequestPage>(
        api.GET('/api/parent/prize-requests', {
          params: { query: { status: filters.status, childId: filters.childId, cursor: pageParam } },
        }),
      ),
    getNextPageParam: (p) => p.nextCursor ?? undefined,
    refetchInterval: 15_000,
  })
}

function invalidateAll(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: ['parent', 'prizeRequests'] })
  void qc.invalidateQueries({ queryKey: qk.bootstrap() })
  void qc.invalidateQueries({ queryKey: ['pendingRequest'] })
  void qc.invalidateQueries({ queryKey: ['book'] })
}

interface PrizeTextVars {
  requestId: number
  prizeText: string
  note?: string
}

export function useCompletePrizeRequest() {
  const qc = useQueryClient()
  return useMutation<PrizeRequest, ApiError, PrizeTextVars>({
    mutationFn: ({ requestId, prizeText, note }) =>
      unwrap<PrizeRequest>(
        api.POST('/api/parent/prize-requests/{requestId}/complete', {
          params: { path: { requestId } },
          body: { prizeText, note },
        }),
      ),
    onSuccess: () => invalidateAll(qc),
  })
}

export function useEditPrizeRequest() {
  const qc = useQueryClient()
  return useMutation<PrizeRequest, ApiError, PrizeTextVars>({
    mutationFn: ({ requestId, prizeText, note }) =>
      unwrap<PrizeRequest>(
        api.PUT('/api/parent/prize-requests/{requestId}', {
          params: { path: { requestId } },
          body: { prizeText, note },
        }),
      ),
    onSuccess: () => invalidateAll(qc),
  })
}

export function useParentCancelPrizeRequest() {
  const qc = useQueryClient()
  return useMutation<PrizeRequest, ApiError, { requestId: number; childId: number }>({
    mutationFn: ({ requestId }) =>
      unwrap<PrizeRequest>(api.POST('/api/prize-requests/{requestId}/cancel', { params: { path: { requestId } } })),
    onSuccess: (_r, { childId }) => {
      qc.setQueryData<PrizeRequest | null>(qk.pendingRequest(childId), null)
      invalidateAll(qc)
    },
  })
}
