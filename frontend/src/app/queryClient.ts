import { QueryClient } from '@tanstack/react-query'
import { ApiError } from '../api/errors'

export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 10_000,
        gcTime: SEVEN_DAYS_MS,
        retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 3,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
      },
      mutations: {
        retry: false,
        // Writes are never queued while offline (TDD 9.6): a tap during an outage fails gently and rolls back.
        networkMode: 'always',
      },
    },
  })
}

export const queryClient: QueryClient = createQueryClient()
