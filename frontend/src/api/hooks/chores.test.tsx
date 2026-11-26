import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server'
import { qk } from '../queryKeys'
import type {
  ChartChore,
  ChartRoutine,
  Chore,
  ChoreInput,
  ChorePage,
  ChoreResult,
  ChoreSuggestion,
  DailyChart,
  StickerPick,
} from '../types'
import {
  useActiveChores,
  useAssignChore,
  useClosedChores,
  useFinishChore,
  useRecentChores,
  useRemoveChore,
  useRevokeChoreSticker,
  useSaveChore,
  useToggleChoreTask,
} from './chores'

const KEY_DATE = '2026-01-05'

function chore(done10: boolean, done11: boolean, over: Partial<ChartChore> = {}): ChartChore {
  const doneCount = (done10 ? 1 : 0) + (done11 ? 1 : 0)
  return {
    choreId: 1,
    name: 'Rake leaves',
    iconKey: 'leaf',
    dueDate: null,
    state: doneCount === 2 ? 'READY_TO_FINISH' : doneCount > 0 ? 'IN_PROGRESS' : 'NOT_STARTED',
    doneCount,
    taskCount: 2,
    tasks: [
      { taskId: 10, label: 'Front yard', iconKey: 'a', done: done10 },
      { taskId: 11, label: 'Back yard', iconKey: 'b', done: done11 },
    ],
    sticker: null,
    ...over,
  }
}

/** A routine that deliberately shares its ids (1, 10, 11) with the chore above. */
function routine(): ChartRoutine {
  return {
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
  }
}

function chart(chores: ChartChore[]): DailyChart {
  return {
    childId: 5,
    date: KEY_DATE,
    isToday: false,
    routines: [routine()],
    chores,
    unclaimedFromEarlierDays: [],
  }
}

const result = (c: ChartChore | null, over: Partial<ChoreResult> = {}): ChoreResult => ({
  chore: c,
  pick: null,
  revoked: null,
  ...over,
})

const input: ChoreInput = {
  name: 'Rake leaves',
  iconKey: 'leaf',
  dueDate: null,
  tasks: [{ id: null, label: 'Front yard', iconKey: 'a' }],
}

const domainChore = (over: Partial<Chore> = {}): Chore => ({
  ...chore(false, false),
  childId: 5,
  closedOn: null,
  createdAt: '2026-01-01T10:00:00Z',
  ...over,
})

function makeClient() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  return { qc, wrapper }
}

const CHART_KEY = qk.chart(5, KEY_DATE)
const choreTasksDone = (qc: QueryClient) =>
  qc.getQueryData<DailyChart>(CHART_KEY)!.chores[0].tasks.map((t) => t.done)
const isInvalidated = (qc: QueryClient, key: readonly unknown[]) => qc.getQueryState(key)?.isInvalidated === true

const TASK_URL = '*/api/children/:childId/chores/:choreId/tasks/:taskId'

describe('chore queries', () => {
  it('useActiveChores returns the items of the active page', async () => {
    const { wrapper } = makeClient()
    let query: URLSearchParams | null = null
    server.use(
      http.get('*/api/parent/chores', ({ request }) => {
        query = new URL(request.url).searchParams
        const page: ChorePage = { items: [domainChore()], nextCursor: null }
        return HttpResponse.json(page)
      }),
    )
    const { result: r } = renderHook(() => useActiveChores({ childId: 5 }), { wrapper })
    await waitFor(() => expect(r.current.data).toHaveLength(1))
    expect(r.current.data![0].name).toBe('Rake leaves')
    expect(query!.get('filter')).toBe('active')
    expect(query!.get('childId')).toBe('5')
  })

  it('useClosedChores pages with nextCursor', async () => {
    const { wrapper } = makeClient()
    const cursors: (string | null)[] = []
    server.use(
      http.get('*/api/parent/chores', ({ request }) => {
        const sp = new URL(request.url).searchParams
        cursors.push(sp.get('cursor'))
        expect(sp.get('filter')).toBe('closed')
        const page: ChorePage = sp.get('cursor')
          ? { items: [domainChore({ choreId: 2 })], nextCursor: null }
          : { items: [domainChore({ choreId: 1 })], nextCursor: 'c2' }
        return HttpResponse.json(page)
      }),
    )
    const { result: r } = renderHook(() => useClosedChores(), { wrapper })
    await waitFor(() => expect(r.current.data?.pages).toHaveLength(1))
    expect(r.current.hasNextPage).toBe(true)
    await act(async () => {
      await r.current.fetchNextPage()
    })
    await waitFor(() =>
      expect(r.current.data!.pages.flatMap((p) => p.items).map((c) => c.choreId)).toEqual([1, 2]),
    )
    expect(r.current.hasNextPage).toBe(false)
    expect(cursors).toEqual([null, 'c2'])
  })

  it('useRecentChores returns the suggestions', async () => {
    const { wrapper } = makeClient()
    const s: ChoreSuggestion = { name: 'Water plants', iconKey: 'plant', tasks: [{ label: 'Indoor', iconKey: 'i' }] }
    server.use(http.get('*/api/parent/chores/recent', () => HttpResponse.json([s])))
    const { result: r } = renderHook(() => useRecentChores(), { wrapper })
    await waitFor(() => expect(r.current.data).toEqual([s]))
  })
})

describe('chore parent mutations', () => {
  function seed(qc: QueryClient) {
    const keys = [
      qk.parent.chores({ filter: 'active' }),
      qk.chart(5, 'today'),
      qk.book(5),
      ['parent', 'history', 5, 'a', 'b'],
    ]
    for (const k of keys) qc.setQueryData(k, {})
    return keys
  }

  it('useAssignChore posts the input and invalidates chores and the chart', async () => {
    const { qc, wrapper } = makeClient()
    const keys = seed(qc)
    let body: unknown
    server.use(
      http.post('*/api/parent/children/:childId/chores', async ({ request, params }) => {
        body = await request.json()
        expect(params.childId).toBe('5')
        return HttpResponse.json(domainChore(), { status: 201 })
      }),
    )
    const { result: r } = renderHook(() => useAssignChore(), { wrapper })
    await act(async () => {
      await r.current.mutateAsync({ childId: 5, input })
    })
    expect(body).toEqual(input)
    expect(isInvalidated(qc, keys[0])).toBe(true)
    expect(isInvalidated(qc, keys[1])).toBe(true)
    expect(isInvalidated(qc, keys[2])).toBe(false)
    expect(isInvalidated(qc, keys[3])).toBe(false)
  })

  it('useAssignChore with alreadyDone also invalidates the book and history', async () => {
    const { qc, wrapper } = makeClient()
    const keys = seed(qc)
    server.use(
      http.post('*/api/parent/children/:childId/chores', () => HttpResponse.json(domainChore(), { status: 201 })),
    )
    const { result: r } = renderHook(() => useAssignChore(), { wrapper })
    await act(async () => {
      await r.current.mutateAsync({ childId: 5, input: { ...input, alreadyDone: true } })
    })
    for (const k of keys) expect(isInvalidated(qc, k)).toBe(true)
  })

  it('useSaveChore puts to the chore id and invalidates', async () => {
    const { qc, wrapper } = makeClient()
    const keys = seed(qc)
    let seen: { id: unknown; body: unknown } | null = null
    server.use(
      http.put('*/api/parent/chores/:choreId', async ({ request, params }) => {
        seen = { id: params.choreId, body: await request.json() }
        return HttpResponse.json(domainChore({ choreId: 7 }))
      }),
    )
    const { result: r } = renderHook(() => useSaveChore(), { wrapper })
    await act(async () => {
      await r.current.mutateAsync({ choreId: 7, childId: 5, input })
    })
    expect(seen).toEqual({ id: '7', body: input })
    expect(isInvalidated(qc, keys[0])).toBe(true)
    expect(isInvalidated(qc, keys[1])).toBe(true)
  })

  it('useRemoveChore deletes and invalidates', async () => {
    const { qc, wrapper } = makeClient()
    const keys = seed(qc)
    let id: unknown
    server.use(
      http.delete('*/api/parent/chores/:choreId', ({ params }) => {
        id = params.choreId
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const { result: r } = renderHook(() => useRemoveChore(), { wrapper })
    await act(async () => {
      await r.current.mutateAsync({ choreId: 3, childId: 5 })
    })
    expect(id).toBe('3')
    expect(isInvalidated(qc, keys[0])).toBe(true)
    expect(isInvalidated(qc, keys[1])).toBe(true)
  })
})

describe('useToggleChoreTask', () => {
  function setup(initial = chart([chore(false, false)])) {
    const { qc, wrapper } = makeClient()
    qc.setQueryData(CHART_KEY, initial)
    const { result: r } = renderHook(() => useToggleChoreTask(5, KEY_DATE), { wrapper })
    return { qc, r }
  }

  it('flips the task optimistically, sends PUT with the CSRF header, then takes the server chore', async () => {
    const { qc, r } = setup()
    let header: string | null = null
    server.use(
      http.get('*/api/children/:childId/days/:date', () => HttpResponse.json(chart([chore(true, false)]))),
      http.put(TASK_URL, async ({ request, params }) => {
        header = request.headers.get('X-Sticker-Bank')
        expect(params).toMatchObject({ childId: '5', choreId: '1', taskId: '10' })
        await delay(30)
        return HttpResponse.json(result(chore(true, false)))
      }),
    )
    let p!: Promise<unknown>
    act(() => {
      p = r.current.mutateAsync({ choreId: 1, taskId: 10, done: true })
    })
    await waitFor(() => expect(choreTasksDone(qc)).toEqual([true, false]))
    const optimistic = qc.getQueryData<DailyChart>(CHART_KEY)!.chores[0]
    expect(optimistic.doneCount).toBe(1)
    expect(optimistic.state).toBe('IN_PROGRESS')
    await act(async () => {
      await p
    })
    expect(header).toBe('1')
    expect(choreTasksDone(qc)).toEqual([true, false])
  })

  it('never sets READY_TO_FINISH optimistically, and unchecking goes back to NOT_STARTED / IN_PROGRESS', async () => {
    const { qc, r } = setup(chart([chore(true, false)]))
    server.use(
      http.put(TASK_URL, async () => {
        await delay(80)
        return HttpResponse.json(result(chore(true, true)))
      }),
      http.delete(TASK_URL, async () => {
        await delay(80)
        return HttpResponse.json(result(chore(false, false)))
      }),
      http.get('*/api/children/:childId/days/:date', () => HttpResponse.json(chart([chore(true, true)]))),
    )
    let p!: Promise<unknown>
    act(() => {
      p = r.current.mutateAsync({ choreId: 1, taskId: 11, done: true })
    })
    await waitFor(() => expect(choreTasksDone(qc)).toEqual([true, true]))
    expect(qc.getQueryData<DailyChart>(CHART_KEY)!.chores[0].state).toBe('IN_PROGRESS')
    await act(async () => {
      await p
    })
    expect(qc.getQueryData<DailyChart>(CHART_KEY)!.chores[0].state).toBe('READY_TO_FINISH')
  })

  it('unchecking the only done task is NOT_STARTED and sends DELETE', async () => {
    const { qc, r } = setup(chart([chore(true, false)]))
    let method = ''
    server.use(
      http.delete(TASK_URL, async ({ request }) => {
        method = request.method
        await delay(50)
        return HttpResponse.json(result(chore(false, false)))
      }),
      http.get('*/api/children/:childId/days/:date', () => HttpResponse.json(chart([chore(false, false)]))),
    )
    let p!: Promise<unknown>
    act(() => {
      p = r.current.mutateAsync({ choreId: 1, taskId: 10, done: false })
    })
    await waitFor(() => expect(choreTasksDone(qc)).toEqual([false, false]))
    expect(qc.getQueryData<DailyChart>(CHART_KEY)!.chores[0].state).toBe('NOT_STARTED')
    await act(async () => {
      await p
    })
    expect(method).toBe('DELETE')
  })

  it('rolls back on an error', async () => {
    const { qc, r } = setup()
    server.use(
      http.put(TASK_URL, () => HttpResponse.json({ status: 500, code: 'UNKNOWN' }, { status: 500 })),
      http.get('*/api/children/:childId/days/:date', () => HttpResponse.json(chart([chore(false, false)]))),
    )
    await act(async () => {
      await r.current.mutateAsync({ choreId: 1, taskId: 10, done: true }).catch(() => undefined)
    })
    expect(choreTasksDone(qc)).toEqual([false, false])
    expect(qc.getQueryData<DailyChart>(CHART_KEY)!.chores[0].state).toBe('NOT_STARTED')
  })

  it('does not reconcile after a NETWORK error', async () => {
    const { qc, r } = setup()
    server.use(http.put(TASK_URL, () => HttpResponse.error()))
    await act(async () => {
      await r.current.mutateAsync({ choreId: 1, taskId: 10, done: true }).catch(() => undefined)
    })
    expect(choreTasksDone(qc)).toEqual([false, false])
    expect(isInvalidated(qc, CHART_KEY)).toBe(false)
  })

  it('keeps both toggles on different tasks when the earlier response arrives last', async () => {
    const { qc, r } = setup()
    server.use(
      http.get('*/api/children/:childId/days/:date', () => HttpResponse.json(chart([chore(true, true)]))),
      http.put(TASK_URL, async ({ params }) => {
        if (params.taskId === '10') {
          await delay(120)
          return HttpResponse.json(result(chore(true, false)))
        }
        await delay(10)
        return HttpResponse.json(result(chore(false, true)))
      }),
    )
    let p1!: Promise<unknown>
    let p2!: Promise<unknown>
    act(() => {
      p1 = r.current.mutateAsync({ choreId: 1, taskId: 10, done: true })
      p2 = r.current.mutateAsync({ choreId: 1, taskId: 11, done: true })
    })
    await act(async () => {
      await Promise.all([p1, p2])
    })
    expect(choreTasksDone(qc)).toEqual([true, true])
    expect(isInvalidated(qc, CHART_KEY)).toBe(true)
  })

  it('reverts only the failed task when another toggle is in flight', async () => {
    const { qc, r } = setup()
    server.use(
      http.get('*/api/children/:childId/days/:date', () => HttpResponse.json(chart([chore(false, true)]))),
      http.put(TASK_URL, async ({ params }) => {
        if (params.taskId === '10') {
          await delay(10)
          return HttpResponse.json({ status: 500, code: 'UNKNOWN' }, { status: 500 })
        }
        await delay(100)
        return HttpResponse.json(result(chore(false, true)))
      }),
    )
    let p1!: Promise<unknown>
    let p2!: Promise<unknown>
    act(() => {
      p1 = r.current.mutateAsync({ choreId: 1, taskId: 10, done: true }).catch(() => 'failed')
      p2 = r.current.mutateAsync({ choreId: 1, taskId: 11, done: true })
    })
    await act(async () => {
      expect(await p1).toBe('failed')
    })
    expect(choreTasksDone(qc)).toEqual([false, true])
    await act(async () => {
      await p2
    })
    expect(choreTasksDone(qc)).toEqual([false, true])
  })

  it('leaves a routine with the same ids untouched, and only changes the chore', async () => {
    const { qc, r } = setup()
    server.use(
      http.get('*/api/children/:childId/days/:date', () => HttpResponse.json(chart([chore(true, false)]))),
      http.put(TASK_URL, async () => {
        await delay(30)
        return HttpResponse.json(result(chore(true, false)))
      }),
    )
    let p!: Promise<unknown>
    act(() => {
      p = r.current.mutateAsync({ choreId: 1, taskId: 10, done: true })
    })
    await waitFor(() => expect(choreTasksDone(qc)).toEqual([true, false]))
    const mid = qc.getQueryData<DailyChart>(CHART_KEY)!
    expect(mid.routines[0].tasks.map((t) => t.done)).toEqual([false, false])
    expect(mid.routines[0].doneCount).toBe(0)
    expect(mid.routines[0].state).toBe('NOT_STARTED')
    await act(async () => {
      await p
    })
    const end = qc.getQueryData<DailyChart>(CHART_KEY)!
    expect(end.routines).toEqual([routine()])
  })

  it('a chore result does not replace a routine that has the same id, and invalidates chores and history', async () => {
    const { qc, r } = setup()
    qc.setQueryData(qk.parent.chores({ filter: 'active' }), [])
    qc.setQueryData(['parent', 'history', 5, 'a', 'b'], {})
    server.use(
      http.get('*/api/children/:childId/days/:date', () => HttpResponse.json(chart([chore(true, false)]))),
      http.put(TASK_URL, () => HttpResponse.json(result(chore(true, false, { name: 'Server name' })))),
    )
    await act(async () => {
      await r.current.mutateAsync({ choreId: 1, taskId: 10, done: true })
    })
    const c = qc.getQueryData<DailyChart>(CHART_KEY)!
    expect(c.chores[0].name).toBe('Server name')
    expect(c.routines[0].name).toBe('Morning')
    expect(isInvalidated(qc, qk.parent.chores({ filter: 'active' }))).toBe(true)
    expect(isInvalidated(qc, ['parent', 'history', 5, 'a', 'b'])).toBe(true)
  })
})

describe('useFinishChore', () => {
  const pick: StickerPick = {
    stickerId: 42,
    label: 'Rake leaves',
    iconKey: 'leaf',
    chartDate: KEY_DATE,
    choices: [],
    status: 'UNCLAIMED',
  } as unknown as StickerPick

  function setup(initial = chart([chore(true, true)])) {
    const { qc, wrapper } = makeClient()
    qc.setQueryData(CHART_KEY, initial)
    const { result: r } = renderHook(() => useFinishChore(5, KEY_DATE), { wrapper })
    return { qc, r }
  }

  it('replaces the chore, seeds the pick and invalidates book, chores and history', async () => {
    const { qc, r } = setup()
    qc.setQueryData(qk.book(5), {})
    qc.setQueryData(qk.parent.chores({ filter: 'closed' }), {})
    qc.setQueryData(['parent', 'history', 5, 'a', 'b'], {})
    server.use(
      http.post('*/api/children/:childId/chores/:choreId/finish', ({ params }) => {
        expect(params).toMatchObject({ childId: '5', choreId: '1' })
        return HttpResponse.json(result(chore(true, true, { state: 'AWAITING_PICK' }), { pick }))
      }),
    )
    await act(async () => {
      await r.current.mutateAsync({ choreId: 1 })
    })
    const c = qc.getQueryData<DailyChart>(CHART_KEY)!
    expect(c.chores[0].state).toBe('AWAITING_PICK')
    expect(c.routines[0].state).toBe('NOT_STARTED')
    expect(qc.getQueryData(qk.pick(42))).toEqual(pick)
    expect(isInvalidated(qc, qk.book(5))).toBe(true)
    expect(isInvalidated(qc, qk.parent.chores({ filter: 'closed' }))).toBe(true)
    expect(isInvalidated(qc, ['parent', 'history', 5, 'a', 'b'])).toBe(true)
  })

  for (const [status, code] of [
    [409, 'CHORE_NOT_READY'],
    [409, 'CHORE_MISSED'],
    [409, 'CHORE_LOCKED'],
    [404, 'NOT_FOUND'],
  ] as const) {
    it(`invalidates the chart on ${code} (${status})`, async () => {
      const { qc, r } = setup()
      server.use(
        http.post('*/api/children/:childId/chores/:choreId/finish', () =>
          HttpResponse.json({ status, code }, { status }),
        ),
        http.get('*/api/children/:childId/days/:date', () => HttpResponse.json(chart([chore(true, false)]))),
      )
      await act(async () => {
        await r.current.mutateAsync({ choreId: 1 }).catch(() => undefined)
      })
      expect(isInvalidated(qc, CHART_KEY)).toBe(true)
    })
  }

  it('does not touch the chart on an unrelated error', async () => {
    const { qc, r } = setup()
    server.use(
      http.post('*/api/children/:childId/chores/:choreId/finish', () =>
        HttpResponse.json({ status: 500, code: 'UNKNOWN' }, { status: 500 }),
      ),
    )
    await act(async () => {
      await r.current.mutateAsync({ choreId: 1 }).catch(() => undefined)
    })
    expect(isInvalidated(qc, CHART_KEY)).toBe(false)
  })
})

describe('useRevokeChoreSticker', () => {
  const revoked = { stickerId: 9, fromStatus: 'AVAILABLE', prizeRequestId: null, requestCancelled: false }
  const earned = chore(true, true, { state: 'EARNED' })

  function setup() {
    const { qc, wrapper } = makeClient()
    qc.setQueryData(CHART_KEY, chart([earned]))
    qc.setQueryData(['parent', 'chores', { filter: 'active' }], [])
    qc.setQueryData(qk.book(5), {})
    const { result: r } = renderHook(() => useRevokeChoreSticker(5), { wrapper })
    return { qc, r }
  }

  it('sends revokeSticker=true, the note and the CSRF header, updates the chart and invalidates', async () => {
    const { qc, r } = setup()
    let seen: { url: URL; header: string | null; body: unknown } | null = null
    server.use(
      http.delete(TASK_URL, async ({ request }) => {
        seen = {
          url: new URL(request.url),
          header: request.headers.get('X-Sticker-Bank'),
          body: await request.json().catch(() => null),
        }
        return HttpResponse.json(result(chore(true, false), { revoked: revoked as never }))
      }),
      http.get('*/api/children/:childId/days/:date', () => HttpResponse.json(chart([chore(true, false)]))),
    )
    await act(async () => {
      await r.current.mutateAsync({ choreId: 1, taskId: 11, note: 'Not finished' })
    })
    expect(seen!.url.searchParams.get('revokeSticker')).toBe('true')
    expect(seen!.url.searchParams.has('removeChore')).toBe(false)
    expect(seen!.header).toBe('1')
    expect(seen!.body).toEqual({ note: 'Not finished' })
    expect(qc.getQueryData<DailyChart>(CHART_KEY)!.chores[0].doneCount).toBe(1)
    expect(isInvalidated(qc, ['parent', 'chores', { filter: 'active' }])).toBe(true)
    expect(isInvalidated(qc, qk.book(5))).toBe(true)
  })

  it('sends removeChore=true when asked and drops the chore from the chart', async () => {
    const { qc, r } = setup()
    let url: URL | null = null
    server.use(
      http.delete(TASK_URL, ({ request }) => {
        url = new URL(request.url)
        return HttpResponse.json(result(null, { revoked: revoked as never }))
      }),
      http.get('*/api/children/:childId/days/:date', () => HttpResponse.json(chart([]))),
    )
    await act(async () => {
      await r.current.mutateAsync({ choreId: 1, taskId: 11, removeChore: true })
    })
    expect(url!.searchParams.get('revokeSticker')).toBe('true')
    expect(url!.searchParams.get('removeChore')).toBe('true')
    expect(qc.getQueryData<DailyChart>(CHART_KEY)!.chores).toEqual([])
  })

  it('treats a 404 after removeChore as success', async () => {
    const { qc, r } = setup()
    server.use(
      http.delete(TASK_URL, () => HttpResponse.json({ status: 404, code: 'NOT_FOUND' }, { status: 404 })),
      http.get('*/api/children/:childId/days/:date', () => HttpResponse.json(chart([]))),
    )
    let out: ChoreResult | undefined
    await act(async () => {
      out = await r.current.mutateAsync({ choreId: 1, taskId: 11, removeChore: true })
    })
    expect(out).toEqual({ chore: null, pick: null, revoked: null })
    expect(qc.getQueryData<DailyChart>(CHART_KEY)!.chores).toEqual([])
    expect(isInvalidated(qc, ['parent', 'chores', { filter: 'active' }])).toBe(true)
  })

  it('still fails on a 404 without removeChore', async () => {
    const { r } = setup()
    server.use(http.delete(TASK_URL, () => HttpResponse.json({ status: 404, code: 'NOT_FOUND' }, { status: 404 })))
    await act(async () => {
      await expect(r.current.mutateAsync({ choreId: 1, taskId: 11 })).rejects.toMatchObject({ status: 404 })
    })
  })
})
