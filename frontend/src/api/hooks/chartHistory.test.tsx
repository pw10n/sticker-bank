import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server'
import { useToggleTask } from './chart'

describe('useToggleTask history invalidation', () => {
  it('invalidates the parent history queries of the child on success', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    )
    server.use(
      http.put('*/api/children/:childId/days/:date/tasks/:taskId', () =>
        HttpResponse.json({
          routine: {
            routineId: 1,
            name: 'Morning',
            iconKey: 'sun',
            color: null,
            state: 'IN_PROGRESS',
            doneCount: 1,
            taskCount: 2,
            tasks: [{ taskId: 10, label: 'Teeth', iconKey: 't', done: true }],
            sticker: null,
          },
          pick: null,
        }),
      ),
    )
    const mine = ['parent', 'history', 5, '2026-01-01', '2026-01-07']
    const other = ['parent', 'history', 6, '2026-01-01', '2026-01-07']
    qc.setQueryData(mine, { days: [] })
    qc.setQueryData(other, { days: [] })

    const { result } = renderHook(() => useToggleTask(5, '2026-01-05'), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ taskId: 10, date: '2026-01-05', done: true })
    })

    await waitFor(() => expect(qc.getQueryState(mine)?.isInvalidated).toBe(true))
    expect(qc.getQueryState(other)?.isInvalidated).toBe(false)
  })
})
