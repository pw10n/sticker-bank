import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server'
import type { Bootstrap } from '../api/types'

export function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
}

export function wrapperFor(client: QueryClient, extra?: (children: ReactNode) => ReactNode) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{extra ? extra(children) : children}</QueryClientProvider>
  }
}

export function bootstrapFixture(over: Partial<Bootstrap> = {}): Bootstrap {
  return {
    setupRequired: false,
    today: '2030-01-01',
    nextDayStartsAt: '2030-01-02T00:00:00Z',
    serverTime: '2030-01-01T12:00:00Z',
    timeZone: 'UTC',
    children: [],
    pendingPrizeRequestCount: 0,
    parentIdleTimeoutSeconds: 300,
    appVersion: 'dev',
    ...over,
  }
}

export function mockBootstrap(data: () => Bootstrap) {
  server.use(http.get('*/api/bootstrap', () => HttpResponse.json(data())))
}
