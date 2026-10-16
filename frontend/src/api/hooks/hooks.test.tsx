import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server'
import { qk } from '../queryKeys'
import type { ChartRoutine, DailyChart, Routine, StickerPick } from '../types'
import {
  useAllAvailableStickers,
  useClaimPick,
  useCreatePrizeRequest,
  useFinishRoutine,
  useParentSession,
  useReorderRoutines,
  useToggleTask,
} from './index'

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  return { qc, wrapper }
}

const routine = (over: Partial<ChartRoutine> = {}): ChartRoutine => ({
  routineId: 1,
  name: 'Morning',
  iconKey: 'sun',
  color: null,
  state: 'NOT_STARTED',
  doneCount: 0,
  taskCount: 2,
  tasks: [
    { taskId: 10, label: 'Teeth', iconKey: 't', done: false },
    { taskId: 11, label: 'Dress', iconKey: 'd', done: false },
  ],
  sticker: null,
  ...over,
})
const chart = (): DailyChart => ({
  childId: 5,
  date: '2026-01-05',
  isToday: true,
  routines: [routine()],
  unclaimedFromEarlierDays: [],
})
const design = { designId: 7, name: 'Star', artworkKey: 'star' }
const pick = (over: Partial<StickerPick> = {}): StickerPick => ({
  stickerId: 99,
  childId: 5,
  chartDate: '2026-01-05',
  routineName: 'Morning',
  status: 'UNCLAIMED',
  autoAwarded: false,
  choices: [design, { designId: 8, name: 'Moon', artworkKey: 'moon' }],
  claimed: null,
  ...over,
})
const problem = (status: number, code: string) =>
  HttpResponse.json({ status, code, title: code }, { status, headers: { 'Content-Type': 'application/problem+json' } })

const togglePath = '*/api/children/5/days/2026-01-05/tasks/10'

describe('useToggleTask', () => {
  it('updates the cache optimistically, then applies the server routine', async () => {
    const { qc, wrapper } = setup()
    qc.setQueryData(qk.chart(5, 'today'), chart())
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    let header: string | null = null
    server.use(
      http.put(togglePath, async ({ request }) => {
        header = request.headers.get('X-Sticker-Bank')
        await gate
        return HttpResponse.json({ routine: routine({ state: 'READY_TO_FINISH', doneCount: 2 }), pick: null })
      }),
    )
    const { result } = renderHook(() => useToggleTask(5, 'today'), { wrapper })
    act(() => result.current.mutate({ taskId: 10, date: '2026-01-05', done: true }))
    await waitFor(() => {
      const r = qc.getQueryData<DailyChart>(qk.chart(5, 'today'))!.routines[0]!
      expect(r.tasks[0]!.done).toBe(true)
      expect(r.doneCount).toBe(1)
      expect(r.state).toBe('IN_PROGRESS')
    })
    release()
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(header).toBe('1')
    // checking tasks never earns a sticker: the server only says the routine is Ready to finish (FR-6.6)
    expect(qc.getQueryData<DailyChart>(qk.chart(5, 'today'))!.routines[0]!.state).toBe('READY_TO_FINISH')
    expect(qc.getQueryData<StickerPick>(qk.pick(99))).toBeUndefined()
  })

  it('puts a ready-to-finish routine straight back in progress when a task is unchecked', async () => {
    const { qc, wrapper } = setup()
    qc.setQueryData(
      qk.chart(5, 'today'),
      {
        ...chart(),
        routines: [
          routine({
            state: 'READY_TO_FINISH',
            doneCount: 2,
            tasks: [
              { taskId: 10, label: 'Teeth', iconKey: 't', done: true },
              { taskId: 11, label: 'Dress', iconKey: 'd', done: true },
            ],
          }),
        ],
      } satisfies DailyChart,
    )
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    server.use(
      http.delete(togglePath, async () => {
        await gate
        return HttpResponse.json({ routine: routine({ state: 'IN_PROGRESS', doneCount: 1 }), pick: null })
      }),
    )
    const { result } = renderHook(() => useToggleTask(5, 'today'), { wrapper })
    act(() => result.current.mutate({ taskId: 10, date: '2026-01-05', done: false }))
    await waitFor(() => {
      const r = qc.getQueryData<DailyChart>(qk.chart(5, 'today'))!.routines[0]!
      expect(r.state).toBe('IN_PROGRESS')
      expect(r.doneCount).toBe(1)
    })
    release()
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })

  it('uses DELETE when undoing', async () => {
    const { qc, wrapper } = setup()
    qc.setQueryData(qk.chart(5, 'today'), chart())
    server.use(
      http.delete(togglePath, () => HttpResponse.json({ routine: routine(), pick: null })),
    )
    const { result } = renderHook(() => useToggleTask(5, 'today'), { wrapper })
    await act(() => result.current.mutateAsync({ taskId: 10, date: '2026-01-05', done: false }))
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })

  it('rolls back on a 409', async () => {
    const { qc, wrapper } = setup()
    qc.setQueryData(qk.chart(5, 'today'), chart())
    server.use(http.put(togglePath, () => problem(409, 'ROUTINE_SKIPPED')))
    const { result } = renderHook(() => useToggleTask(5, 'today'), { wrapper })
    act(() => result.current.mutate({ taskId: 10, date: '2026-01-05', done: true }))
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(qc.getQueryData<DailyChart>(qk.chart(5, 'today'))!.routines[0]!.tasks[0]!.done).toBe(false)
  })

  it('invalidates bootstrap and chart on DAY_CHANGED', async () => {
    const { qc, wrapper } = setup()
    qc.setQueryData(qk.chart(5, 'today'), chart())
    qc.setQueryData(qk.bootstrap(), { x: 1 })
    server.use(http.put(togglePath, () => problem(409, 'DAY_CHANGED')))
    const { result } = renderHook(() => useToggleTask(5, 'today'), { wrapper })
    act(() => result.current.mutate({ taskId: 10, date: '2026-01-05', done: true }))
    await waitFor(() => expect(result.current.error?.code).toBe('DAY_CHANGED'))
    expect(qc.getQueryState(qk.bootstrap())?.isInvalidated).toBe(true)
    expect(qc.getQueryState(qk.chart(5, 'today'))?.isInvalidated).toBe(true)
  })
})

describe('useFinishRoutine', () => {
  const finishPath = '*/api/children/5/days/2026-01-05/routines/1/finish'

  it('posts I\'m Done!, applies the routine and seeds the pick', async () => {
    const { qc, wrapper } = setup()
    qc.setQueryData(qk.chart(5, 'today'), { ...chart(), routines: [routine({ state: 'READY_TO_FINISH', doneCount: 2 })] })
    let header: string | null = null
    server.use(
      http.post(finishPath, ({ request }) => {
        header = request.headers.get('X-Sticker-Bank')
        return HttpResponse.json({ routine: routine({ state: 'AWAITING_PICK', doneCount: 2 }), pick: pick() })
      }),
    )
    const { result } = renderHook(() => useFinishRoutine(5, 'today'), { wrapper })
    await act(() => result.current.mutateAsync({ routineId: 1, date: '2026-01-05' }))
    expect(header).toBe('1')
    expect(qc.getQueryData<DailyChart>(qk.chart(5, 'today'))!.routines[0]!.state).toBe('AWAITING_PICK')
    expect(qc.getQueryData<StickerPick>(qk.pick(99))?.stickerId).toBe(99)
  })

  it('invalidates bootstrap and chart on DAY_CHANGED', async () => {
    const { qc, wrapper } = setup()
    qc.setQueryData(qk.chart(5, 'today'), chart())
    qc.setQueryData(qk.bootstrap(), { x: 1 })
    server.use(http.post(finishPath, () => problem(409, 'DAY_CHANGED')))
    const { result } = renderHook(() => useFinishRoutine(5, 'today'), { wrapper })
    act(() => result.current.mutate({ routineId: 1, date: '2026-01-05' }))
    await waitFor(() => expect(result.current.error?.code).toBe('DAY_CHANGED'))
    expect(qc.getQueryState(qk.bootstrap())?.isInvalidated).toBe(true)
    expect(qc.getQueryState(qk.chart(5, 'today'))?.isInvalidated).toBe(true)
  })

  it('reloads the chart on ROUTINE_NOT_READY', async () => {
    const { qc, wrapper } = setup()
    qc.setQueryData(qk.chart(5, 'today'), chart())
    server.use(http.post(finishPath, () => problem(409, 'ROUTINE_NOT_READY')))
    const { result } = renderHook(() => useFinishRoutine(5, 'today'), { wrapper })
    act(() => result.current.mutate({ routineId: 1, date: '2026-01-05' }))
    await waitFor(() => expect(result.current.error?.code).toBe('ROUTINE_NOT_READY'))
    expect(qc.getQueryState(qk.chart(5, 'today'))?.isInvalidated).toBe(true)
  })
})

describe('useClaimPick', () => {
  it('sets the claimed state', async () => {
    const { qc, wrapper } = setup()
    qc.setQueryData(qk.pick(99), pick())
    server.use(
      http.post('*/api/stickers/99/pick', () =>
        HttpResponse.json({
          stickerId: 99, childId: 5, status: 'AVAILABLE', source: 'EARNED', chartDate: '2026-01-05',
          routineName: 'Morning', routineIconKey: 'sun', design, earnedAt: '2026-01-05T10:00:00Z',
          claimedAt: '2026-01-05T10:01:00Z', prizeRequestId: null,
        }),
      ),
    )
    const { result } = renderHook(() => useClaimPick(5), { wrapper })
    await act(() => result.current.mutateAsync({ stickerId: 99, designId: 7 }))
    const p = qc.getQueryData<StickerPick>(qk.pick(99))!
    expect(p.status).toBe('AVAILABLE')
    expect(p.choices).toEqual([])
    expect(p.claimed?.designId).toBe(7)
  })
})

describe('useAllAvailableStickers', () => {
  it('follows nextCursor across pages', async () => {
    const { wrapper } = setup()
    const counts = { available: 2, pending: 0, used: 0, totalEarned: 2, unclaimed: 0 }
    const item = (id: number) => ({
      stickerId: id, childId: 5, status: 'AVAILABLE', source: 'EARNED', chartDate: '2026-01-05',
      routineName: null, routineIconKey: null, design, earnedAt: '2026-01-05T10:00:00Z',
      claimedAt: null, prizeRequestId: null,
    })
    server.use(
      http.get('*/api/children/5/stickers', ({ request }) => {
        const u = new URL(request.url)
        expect(u.searchParams.get('status')).toBe('AVAILABLE')
        expect(u.searchParams.get('limit')).toBe('200')
        return u.searchParams.get('cursor') === 'c1'
          ? HttpResponse.json({ counts, items: [item(2)], nextCursor: null })
          : HttpResponse.json({ counts, items: [item(1)], nextCursor: 'c1' })
      }),
    )
    const { result } = renderHook(() => useAllAvailableStickers(5), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.items.map((i) => i.stickerId)).toEqual([1, 2])
  })
})

describe('useCreatePrizeRequest', () => {
  it('sets the pending cache and sends the CSRF header', async () => {
    const { qc, wrapper } = setup()
    let header: string | null = null
    const req = { requestId: 3, childId: 5, status: 'PENDING', stickers: [] }
    server.use(
      http.post('*/api/children/5/prize-requests', ({ request }) => {
        header = request.headers.get('X-Sticker-Bank')
        return HttpResponse.json(req, { status: 201 })
      }),
    )
    const { result } = renderHook(() => useCreatePrizeRequest(5), { wrapper })
    await act(() => result.current.mutateAsync({ stickerIds: [1] }))
    expect(header).toBe('1')
    expect(qc.getQueryData(qk.pendingRequest(5))).toEqual(req)
  })
})

describe('useReorderRoutines', () => {
  const mk = (id: number) => ({ id }) as unknown as Routine
  it('reorders optimistically', async () => {
    const { qc, wrapper } = setup()
    qc.setQueryData(qk.parent.routines(5), [mk(1), mk(2), mk(3)])
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    server.use(
      http.put('*/api/parent/children/5/routines/order', async () => {
        await gate
        return new HttpResponse(null, { status: 204 })
      }),
      http.get('*/api/parent/children/5/routines', () => HttpResponse.json([mk(3), mk(1), mk(2)])),
    )
    const { result } = renderHook(() => useReorderRoutines(5), { wrapper })
    act(() => result.current.mutate({ routineIds: [3, 1, 2] }))
    await waitFor(() =>
      expect(qc.getQueryData<Routine[]>(qk.parent.routines(5))!.map((r) => r.id)).toEqual([3, 1, 2]),
    )
    release()
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })

  it('rolls back on error', async () => {
    const { qc, wrapper } = setup()
    qc.setQueryData(qk.parent.routines(5), [mk(1), mk(2)])
    server.use(
      http.put('*/api/parent/children/5/routines/order', () => problem(400, 'VALIDATION_FAILED')),
      http.get('*/api/parent/children/5/routines', () => HttpResponse.json([mk(1), mk(2)])),
    )
    const { result } = renderHook(() => useReorderRoutines(5), { wrapper })
    act(() => result.current.mutate({ routineIds: [2, 1] }))
    await waitFor(() => expect(result.current.isError).toBe(true))
    await waitFor(() =>
      expect(qc.getQueryData<Routine[]>(qk.parent.routines(5))!.map((r) => r.id)).toEqual([1, 2]),
    )
  })
})

describe('useParentSession', () => {
  it('surfaces a 401 as ApiError PARENT_SESSION_REQUIRED', async () => {
    const { wrapper } = setup()
    server.use(http.get('*/api/parent/session', () => problem(401, 'PARENT_SESSION_REQUIRED')))
    const { result } = renderHook(() => useParentSession(), { wrapper })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error?.code).toBe('PARENT_SESSION_REQUIRED')
  })
})
