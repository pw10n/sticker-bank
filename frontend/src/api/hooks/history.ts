import { useQuery } from '@tanstack/react-query'
import { api, unwrap } from '../client'
import type { ApiError } from '../errors'
import { qk } from '../queryKeys'
import type { History } from '../types'

export function useHistory(childId: number, from: string, to: string) {
  return useQuery<History, ApiError>({
    queryKey: qk.parent.history(childId, from, to),
    queryFn: () =>
      unwrap<History>(
        api.GET('/api/parent/children/{childId}/history', {
          params: { path: { childId }, query: { from, to } },
        }),
      ),
  })
}
