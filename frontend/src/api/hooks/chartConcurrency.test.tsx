import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server'
import { qk } from '../queryKeys'
import type { ChartRoutine, DailyChart } from '../types'
import { useToggleTask } from './chart'

const KEY_DATE = '2026-01-05'

function routine(done10: boolean, done11: boolean): ChartRoutine {
  const doneCount = (done10 ? 1 : 0) + (done11 ? 1 : 0)
  return {
    routineId: 1,
    name: 'Morning',
    iconKey: 'sun',
    color: null,
    state: doneCount === 2 ? 'READY_TO_FINISH' : doneCount > 0 ? 'IN_PROGRESS' : 'NOT_STARTED',
    doneCount,
    taskCount: 2,
    tasks: [
      { taskId: 10, label: 'Teeth', iconKey: 't', done: done10 },
      { taskId: 11, label: 'Dress', iconKey: 'd', done: done11 },
    ],
    sticker: null,
  } as ChartRoutine
}

function chart(done10: boolean, done11: boolean): DailyChart {
  return {
    childId: 5,
    date: KEY_DATE,
    isToday: false,
    routines: [routine(done10, done11)],
    unclaimedFromEarlierDays: [],
  }
}

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  qc.setQueryData(qk.chart(5, KEY_DATE), chart(false, false))
  const { result } = renderHook(() => useToggleTask(5, KEY_DATE), { wrapper })
  return { qc, result }
}

const tasksDone = (qc: QueryClient) =>
  qc.getQueryData<DailyChart>(qk.chart(5, KEY_DATE))!.routines[0].tasks.map((t) => t.done)

const PUT = '*/api/children/:childId/days/:date/tasks/:taskId'

describe('useToggleTask concurrency', () => {
  it('keeps both optimistic toggles when the earlier response arrives last', async () => {
    const { qc, result } = setup()
    server.use(
      http.get('*/api/children/:childId/days/:date', () => HttpResponse.json(chart(true, true))),
      http.put(PUT, async ({ params }) => {
        if (params.taskId === '10') {
          await delay(120)
          return HttpResponse.json({ routine: routine(true, false), pick: null })
        }
        await delay(10)
        return HttpResponse.json({ routine: routine(false, true), pick: null })
      }),
    )
    let p1!: Promise<unknown>
    let p2!: Promise<unknown>
    act(() => {
      p1 = result.current.mutateAsync({ taskId: 10, date: KEY_DATE, done: true })
      p2 = result.current.mutateAsync({ taskId: 11, date: KEY_DATE, done: true })
    })
    await act(async () => {
      await Promise.all([p1, p2])
    })
    // Before any refetch resolves, both optimistic toggles are intact.
    expect(tasksDone(qc)).toEqual([true, true])
    expect(qc.getQueryState(qk.chart(5, KEY_DATE))?.isInvalidated).toBe(true)
  })

  it('reverts only the failed task when another toggle is in flight', async () => {
    const { qc, result } = setup()
    server.use(
      http.get('*/api/children/:childId/days/:date', () => HttpResponse.json(chart(false, true))),
      http.put(PUT, async ({ params }) => {
        if (params.taskId === '10') {
          await delay(10)
          return HttpResponse.json({ status: 500, code: 'UNKNOWN' }, { status: 500 })
        }
        await delay(100)
        return HttpResponse.json({ routine: routine(false, true), pick: null })
      }),
    )
    let p1!: Promise<unknown>
    let p2!: Promise<unknown>
    act(() => {
      p1 = result.current.mutateAsync({ taskId: 10, date: KEY_DATE, done: true }).catch(() => 'failed')
      p2 = result.current.mutateAsync({ taskId: 11, date: KEY_DATE, done: true })
    })
    await act(async () => {
      expect(await p1).toBe('failed')
    })
    expect(tasksDone(qc)).toEqual([false, true])
    await act(async () => {
      await p2
    })
    expect(tasksDone(qc)).toEqual([false, true])
  })

  it('checking the last task ends Ready to finish without ever seeding a pick', async () => {
    const { qc, result } = setup()
    server.use(
      http.get('*/api/children/:childId/days/:date', () => HttpResponse.json(chart(true, true))),
      http.put(PUT, async ({ params }) => {
        if (params.taskId === '10') {
          await delay(10)
          return HttpResponse.json({ routine: routine(true, false), pick: null })
        }
        await delay(150)
        return HttpResponse.json({ routine: routine(true, true), pick: null })
      }),
    )
    let p1!: Promise<unknown>
    let p2!: Promise<unknown>
    act(() => {
      p1 = result.current.mutateAsync({ taskId: 10, date: KEY_DATE, done: true })
      p2 = result.current.mutateAsync({ taskId: 11, date: KEY_DATE, done: true })
    })
    await act(async () => {
      await p1
    })
    // the earlier, stale response must not undo the later optimistic tap
    expect(tasksDone(qc)).toEqual([true, true])
    await act(async () => {
      await p2
    })
    await waitFor(() => expect(tasksDone(qc)).toEqual([true, true]))
    await waitFor(() => expect(qc.getQueryData<DailyChart>(qk.chart(5, KEY_DATE))!.routines[0].state).toBe('READY_TO_FINISH'))
    expect(qc.getQueryCache().findAll({ queryKey: ['pick'] })).toHaveLength(0)
  })

  it('a single toggle still writes the server routine', async () => {
    const { qc, result } = setup()
    const serverRoutine = { ...routine(true, false), name: 'Server Morning' }
    server.use(
      http.get('*/api/children/:childId/days/:date', () => HttpResponse.json(chart(true, false))),
      http.put(PUT, () => HttpResponse.json({ routine: serverRoutine, pick: null })),
    )
    await act(async () => {
      await result.current.mutateAsync({ taskId: 10, date: KEY_DATE, done: true })
    })
    expect(qc.getQueryData<DailyChart>(qk.chart(5, KEY_DATE))!.routines[0].name).toBe('Server Morning')
  })
})
