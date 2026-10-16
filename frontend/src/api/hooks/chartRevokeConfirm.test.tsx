import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server'
import { qk } from '../queryKeys'
import type { DailyChart } from '../types'
import { useToggleTask } from './chart'

const DATE = '2026-01-05'
const sticker = { stickerId: 9, status: 'AVAILABLE', design: null, prizeRequestId: null, revocable: true }

function routine(done: boolean) {
  return {
    routineId: 1,
    name: 'Morning',
    iconKey: 'sun',
    color: null,
    state: 'EARNED' as const,
    doneCount: done ? 2 : 1,
    taskCount: 2,
    tasks: [
      { taskId: 10, label: 'Teeth', iconKey: 't', done: true },
      { taskId: 11, label: 'Dress', iconKey: 'd', done },
    ],
    sticker,
  }
}

describe('useToggleTask with REVOKE_CONFIRMATION_REQUIRED', () => {
  it('rolls back the optimistic undo and exposes the sticker on the error', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    )
    const initial = { childId: 5, date: DATE, isToday: false, routines: [routine(true)], unclaimedFromEarlierDays: [] }
    qc.setQueryData(qk.chart(5, DATE), initial)
    server.use(
      http.delete('*/api/children/:childId/days/:date/tasks/:taskId', () =>
        HttpResponse.json(
          {
            title: 'Confirm',
            status: 409,
            code: 'REVOKE_CONFIRMATION_REQUIRED',
            sticker,
          },
          { status: 409, headers: { 'Content-Type': 'application/problem+json' } },
        ),
      ),
      http.get('*/api/children/:childId/days/:date', () => HttpResponse.json(initial)),
    )
    const { result } = renderHook(() => useToggleTask(5, DATE), { wrapper })
    act(() => result.current.mutate({ taskId: 11, date: DATE, done: false }))
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error?.code).toBe('REVOKE_CONFIRMATION_REQUIRED')
    expect((result.current.error?.problem as { sticker?: { stickerId: number } } | undefined)?.sticker?.stickerId).toBe(9)
    const chart = qc.getQueryData<DailyChart>(qk.chart(5, DATE))!
    expect(chart.routines[0].tasks.map((t) => t.done)).toEqual([true, true])
    expect(chart.routines[0].doneCount).toBe(2)
    expect(chart.routines[0].state).toBe('EARNED')
    // Not stuck: the mutation is not pending and can be retried.
    expect(result.current.isPending).toBe(false)
  })
})
