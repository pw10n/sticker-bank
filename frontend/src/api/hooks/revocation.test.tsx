import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server'
import { qk } from '../queryKeys'
import type { DailyChart } from '../types'
import { useRevokeSticker } from './revocation'

const routine = (doneCount: number) => ({
  routineId: 1,
  name: 'Morning',
  iconKey: 'sun',
  color: null,
  state: 'IN_PROGRESS' as const,
  doneCount,
  taskCount: 2,
  tasks: [{ taskId: 10, label: 'Teeth', iconKey: 't', done: false }],
  sticker: null,
})

const revoked = { stickerId: 9, fromStatus: 'AVAILABLE', prizeRequestId: null, requestCancelled: false }

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  return { qc, wrapper }
}

const chartOf = (doneCount: number): DailyChart => ({
  childId: 5,
  date: '2026-01-05',
  isToday: false,
  routines: [routine(doneCount)],
  unclaimedFromEarlierDays: [],
})

describe('useRevokeSticker', () => {
  it('sends DELETE with revokeSticker=true, the note and the CSRF header, then updates the cache', async () => {
    const { qc, wrapper } = setup()
    let seen: { url: URL; header: string | null; body: unknown } | null = null
    server.use(
      http.delete('*/api/children/:childId/days/:date/tasks/:taskId', async ({ request }) => {
        seen = {
          url: new URL(request.url),
          header: request.headers.get('X-Sticker-Bank'),
          body: await request.json().catch(() => null),
        }
        return HttpResponse.json({ routine: routine(1), pick: null, revoked })
      }),
    )
    const chartKey = qk.chart(5, '2026-01-05')
    qc.setQueryData<DailyChart>(chartKey, chartOf(2))
    const history = ['parent', 'history', 5, '2026-01-01', '2026-01-07']
    qc.setQueryData(history, { days: [] })

    const { result } = renderHook(() => useRevokeSticker(5, '2026-01-05'), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ taskId: 10, note: 'Tapped by mistake' })
    })

    expect(seen).not.toBeNull()
    const s = seen as unknown as { url: URL; header: string | null; body: unknown }
    expect(s.url.pathname).toBe('/api/children/5/days/2026-01-05/tasks/10')
    expect(s.url.searchParams.get('revokeSticker')).toBe('true')
    expect(s.header).toBe('1')
    expect(s.body).toEqual({ note: 'Tapped by mistake' })
    expect(qc.getQueryData<DailyChart>(chartKey)?.routines[0]?.doneCount).toBe(1)
    await waitFor(() => expect(qc.getQueryState(history)?.isInvalidated).toBe(true))
  })

  it('sends no body without a note', async () => {
    const { wrapper } = setup()
    let body: unknown = 'unset'
    server.use(
      http.delete('*/api/children/:childId/days/:date/tasks/:taskId', async ({ request }) => {
        body = await request.text()
        return HttpResponse.json({ routine: routine(1), pick: null, revoked })
      }),
    )
    const { result } = renderHook(() => useRevokeSticker(5, '2026-01-05'), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ taskId: 10 })
    })
    expect(body).toBe('')
  })

  it('also replaces the routine in the cached "today" chart when the date is today', async () => {
    const { qc, wrapper } = setup()
    server.use(
      http.delete('*/api/children/:childId/days/:date/tasks/:taskId', () =>
        HttpResponse.json({ routine: routine(1), pick: null, revoked }),
      ),
    )
    qc.setQueryData(qk.bootstrap(), { today: '2026-01-05' })
    qc.setQueryData<DailyChart>(qk.chart(5, 'today'), chartOf(2))
    const { result } = renderHook(() => useRevokeSticker(5, '2026-01-05'), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ taskId: 10 })
    })
    expect(qc.getQueryData<DailyChart>(qk.chart(5, 'today'))?.routines[0]?.doneCount).toBe(1)
  })
})
