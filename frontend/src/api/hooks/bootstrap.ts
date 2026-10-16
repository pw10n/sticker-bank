import { useQuery } from '@tanstack/react-query'
import { api, unwrap } from '../client'
import { qk } from '../queryKeys'

export function useBootstrap() {
  return useQuery({
    queryKey: qk.bootstrap(),
    queryFn: () => unwrap(api.GET('/api/bootstrap')),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })
}
