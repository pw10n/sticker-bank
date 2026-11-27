import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChartChore, DailyChart } from '../../api/types'
import { DeviceSettingsProvider } from '../../app/deviceSettings'
import { OnlineStatusProvider } from '../../app/online'
import { getDailyChart, today } from '../../mocks/fakeState'
import { resetFakeApi, setFakeToday } from '../../mocks/fakeApi'
import { server } from '../../mocks/server'
import { SoundContext } from '../../sound/soundContext'
import { celebrateRoutine } from '../../ui'
import ChildLayout from '../ChildLayout'
import DailyChartScreen from './DailyChartScreen'

vi.mock('../../ui/celebrate', async (orig) => {
  const actual = await orig<typeof import('../../ui/celebrate')>()
  return { ...actual, celebrateRoutine: vi.fn(() => Promise.resolve()), celebrateTask: vi.fn() }
})

function memoryStorage(): Storage {
  const m = new Map<string, string>()
  return {
    get length() {
      return m.size
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, v),
  }
}

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>
}

const play = vi.fn()
let chart: DailyChart
const calls: string[] = []

function mkChore(over: Partial<ChartChore> & { choreId: number }): ChartChore {
  return {
    name: `Chore ${over.choreId}`,
    iconKey: 'broom',
    dueDate: null,
    state: 'NOT_STARTED',
    doneCount: 0,
    taskCount: 1,
    sticker: null,
    tasks: [{ taskId: over.choreId * 100, label: `Task ${over.choreId}`, iconKey: 'broom', done: false }],
    ...over,
  }
}

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter(
    [
      {
        path: '/c/:childId',
        element: <ChildLayout />,
        children: [
          { index: true, element: <DailyChartScreen /> },
          { path: 'pick/:stickerId', element: <Where /> },
        ],
      },
    ],
    { initialEntries: ['/c/1'] },
  )
  render(
    <QueryClientProvider client={client}>
      <DeviceSettingsProvider>
        <SoundContext.Provider value={{ play }}>
          <OnlineStatusProvider>
            <RouterProvider router={router} />
          </OnlineStatusProvider>
        </SoundContext.Provider>
      </DeviceSettingsProvider>
    </QueryClientProvider>,
  )
  return { router, client }
}

function load(chores: ChartChore[], opts: { routines?: boolean } = {}) {
  resetFakeApi('default')
  setFakeToday(null)
  const base = getDailyChart(1, today())
  chart = { ...base, routines: opts.routines === false ? [] : base.routines, chores }
  calls.length = 0
  server.use(http.get('*/api/children/:childId/days/today', () => HttpResponse.json(chart)))
}

function problem(status: number, code: string) {
  return HttpResponse.json({ status, code, title: code }, { status })
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
  // The device settings keep an in-memory copy between tests; a stored value takes precedence over it.
  localStorage.setItem('sb.announcedChores', '{}')
  play.mockClear()
  vi.mocked(celebrateRoutine).mockClear()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('chores on the chart', () => {
  it('draws the Chores group after the routines, in the order served', async () => {
    load([mkChore({ choreId: 7 }), mkChore({ choreId: 3 })])
    setup()
    const group = await screen.findByTestId('chores-group')
    expect(within(group).getByRole('heading', { name: /Chores/ })).toBeInTheDocument()
    const routine = screen.getByRole('region', { name: 'Morning Routine' })
    expect(routine.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const names = within(group)
      .getAllByRole('region')
      .map((r) => r.getAttribute('aria-label'))
    expect(names).toEqual(['Chore 7', 'Chore 3'])
    const wrapper = within(group).getByRole('region', { name: 'Chore 7' }).parentElement as HTMLElement
    expect(wrapper).toHaveClass('basis-[23rem]', 'max-w-[28rem]', 'grow')
    expect(wrapper.parentElement).toHaveClass('flex-wrap', 'justify-center', 'gap-6')
  })

  it('shows the empty state only with no routines and no chores', async () => {
    load([], { routines: false })
    setup()
    expect(await screen.findByText(/No routines today/)).toBeInTheDocument()
  })

  it('shows chores instead of the empty state when there are no routines', async () => {
    load([mkChore({ choreId: 1 })], { routines: false })
    setup()
    expect(await screen.findByRole('region', { name: 'Chore 1' })).toBeInTheDocument()
    expect(screen.queryByText(/No routines today/)).not.toBeInTheDocument()
  })

  it('checks a chore task with the pop sound', async () => {
    load([mkChore({ choreId: 1 })])
    server.use(
      http.put('*/api/children/:c/chores/:id/tasks/:t', ({ params }) => {
        calls.push(`put ${String(params.id)}/${String(params.t)}`)
        return HttpResponse.json({ chore: null, pick: null, revoked: null })
      }),
    )
    setup()
    await userEvent.click(await screen.findByRole('button', { name: 'Task 1' }))
    await waitFor(() => expect(calls).toEqual(['put 1/100']))
    expect(play).toHaveBeenCalledWith('pop')
  })

  it("I'm Done! finishes the chore, celebrates and opens the pick", async () => {
    load([mkChore({ choreId: 1, state: 'READY_TO_FINISH', doneCount: 1, tasks: [{ taskId: 100, label: 'Task 1', iconKey: 'broom', done: true }] })])
    server.use(
      http.post('*/api/children/:c/chores/:id/finish', () =>
        HttpResponse.json({
          chore: mkChore({ choreId: 1, state: 'AWAITING_PICK', doneCount: 1 }),
          pick: { stickerId: 55, childId: 1, chartDate: today(), choices: [], claimed: null, routineName: 'Chore 1', status: 'UNCLAIMED', autoAwarded: false },
          revoked: null,
        }),
      ),
    )
    const { router } = setup()
    const card = await screen.findByRole('region', { name: 'Chore 1' })
    const done = await within(card).findByRole('button', { name: /I'm Done!/ })
    await userEvent.click(done)
    await new Promise((r) => setTimeout(r, 700))
    await userEvent.click(done)
    await waitFor(() => expect(router.state.location.pathname).toBe('/c/1/pick/55'))
    expect(celebrateRoutine).toHaveBeenCalledTimes(1)
    expect(play).toHaveBeenCalledWith('fanfare')
  })

  it('keeps a routine and a chore with the same ids apart', async () => {
    resetFakeApi('default')
    setFakeToday(null)
    const base = getDailyChart(1, today())
    const r = base.routines.find((x) => x.state !== 'SKIPPED')!
    const t = r.tasks.find((x) => !x.done)!
    const same = mkChore({
      choreId: r.routineId,
      tasks: [{ taskId: t.taskId, label: 'Same id task', iconKey: 'broom', done: false }],
    })
    chart = { ...base, chores: [same] }
    server.use(
      http.get('*/api/children/:childId/days/today', () => HttpResponse.json(chart)),
      http.put('*/api/children/:c/tasks/:t/days/:d', async () => {
        await new Promise((res) => setTimeout(res, 300))
        return HttpResponse.json({ routine: r, pick: null })
      }),
    )
    setup()
    const routineCard = await screen.findByRole('region', { name: r.name })
    const choreCard = screen.getByRole('region', { name: 'Chore ' + r.routineId })
    expect(routineCard).toHaveAttribute('data-highlighted', 'true')
    expect(choreCard).not.toHaveAttribute('data-highlighted')
    await userEvent.click(within(routineCard).getByRole('button', { name: t.label }))
    expect(within(choreCard).getByRole('button', { name: 'Same id task' })).not.toHaveAttribute('aria-busy')
  })

  it.each([
    ['CHORE_NOT_READY', 409],
    ['CHORE_MISSED', 409],
    ['CHORE_LOCKED', 409],
    ['NOT_FOUND', 404],
  ])('reloads quietly on %s from a chore tap', async (code, status) => {
    load([mkChore({ choreId: 1 })])
    server.use(http.put('*/api/children/:c/chores/:id/tasks/:t', () => problem(status, code)))
    setup()
    await userEvent.click(await screen.findByRole('button', { name: 'Task 1' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Task 1' })).toHaveAttribute('aria-pressed', 'false'))
    expect(play).not.toHaveBeenCalledWith('error')
  })

  it('plays the error sound for any other chore error', async () => {
    load([mkChore({ choreId: 1 })])
    server.use(http.put('*/api/children/:c/chores/:id/tasks/:t', () => problem(500, 'INTERNAL')))
    setup()
    await userEvent.click(await screen.findByRole('button', { name: 'Task 1' }))
    await waitFor(() => expect(play).toHaveBeenCalledWith('error'))
  })

  it('reloads quietly when finishing a chore that is no longer ready', async () => {
    load([mkChore({ choreId: 1, state: 'READY_TO_FINISH', doneCount: 1, tasks: [{ taskId: 100, label: 'Task 1', iconKey: 'broom', done: true }] })])
    server.use(http.post('*/api/children/:c/chores/:id/finish', () => problem(409, 'CHORE_NOT_READY')))
    const { router } = setup()
    const card = await screen.findByRole('region', { name: 'Chore 1' })
    const done = await within(card).findByRole('button', { name: /I'm Done!/ })
    await new Promise((r) => setTimeout(r, 700))
    await userEvent.click(done)
    await waitFor(() => expect(within(card).getByRole('button', { name: /I'm Done!/ })).not.toHaveAttribute('aria-busy'))
    expect(play).not.toHaveBeenCalledWith('error')
    expect(router.state.location.pathname).toBe('/c/1')
  })
})

describe('new chore toast', () => {
  it('chimes and shows one toast with the chore, once per chore per device', async () => {
    load([mkChore({ choreId: 1, name: 'Feed the dog' })])
    const { client } = setup()
    const toast = await screen.findByRole('button', { name: /New chore!/ })
    expect(toast).toHaveTextContent('Feed the dog')
    expect(toast.className).toContain('min-h-[72px]')
    expect(play.mock.calls.filter((c) => c[0] === 'chime')).toHaveLength(1)
    await act(async () => {
      await client.invalidateQueries()
    })
    expect(play.mock.calls.filter((c) => c[0] === 'chime')).toHaveLength(1)
    expect(JSON.parse(localStorage.getItem('sb.announcedChores') ?? '{}')).toEqual({ '1': [1] })
  })

  it('shows a single toast for several chores', async () => {
    load([mkChore({ choreId: 1 }), mkChore({ choreId: 2 })])
    setup()
    expect(await screen.findByRole('button', { name: /2 new chores!/ })).toBeInTheDocument()
    expect(play.mock.calls.filter((c) => c[0] === 'chime')).toHaveLength(1)
  })

  it('does not announce a finished chore', async () => {
    load([mkChore({ choreId: 1, state: 'EARNED', doneCount: 1 }), mkChore({ choreId: 2, state: 'AWAITING_PICK', doneCount: 1 })])
    setup()
    await screen.findByTestId('chores-group')
    expect(screen.queryByTestId('new-chore-toast')).not.toBeInTheDocument()
    expect(play).not.toHaveBeenCalledWith('chime')
  })

  it('does not announce a chore already announced on this device', async () => {
    localStorage.setItem('sb.announcedChores', JSON.stringify({ '1': [1, 99] }))
    load([mkChore({ choreId: 1 })])
    setup()
    await screen.findByTestId('chores-group')
    expect(screen.queryByTestId('new-chore-toast')).not.toBeInTheDocument()
    await waitFor(() => expect(JSON.parse(localStorage.getItem('sb.announcedChores') ?? '{}')).toEqual({ '1': [1] }))
  })

  it('tap scrolls to the chore card and dismisses the toast', async () => {
    load([mkChore({ choreId: 1 }), mkChore({ choreId: 2 })])
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    setup()
    await userEvent.click(await screen.findByRole('button', { name: /2 new chores!/ }))
    const last = scroll.mock.calls.length - 1
    expect(scroll.mock.contexts[last]).toBe(screen.getByRole('region', { name: 'Chore 1' }))
    expect(screen.queryByTestId('new-chore-toast')).not.toBeInTheDocument()
  })

  it('goes away by itself after 8 seconds', async () => {
    load([mkChore({ choreId: 1 })])
    // Fake timers stall the fake API's fetches, so capture the 8 s timer and fire it by hand.
    const realSet = globalThis.setTimeout
    const eight: (() => void)[] = []
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number, ...rest: unknown[]) => {
      if (ms === 8000) {
        eight.push(fn)
        return 0 as unknown as ReturnType<typeof setTimeout>
      }
      return realSet(fn, ms, ...rest)
    }) as typeof setTimeout)
    setup()
    await screen.findByTestId('new-chore-toast')
    expect(eight).toHaveLength(1)
    act(() => eight[0]!())
    expect(screen.queryByTestId('new-chore-toast')).not.toBeInTheDocument()
    vi.restoreAllMocks()
  })

  it('announces a chore that arrives in a later response, without remounting the screen', async () => {
    load([mkChore({ choreId: 1 })])
    localStorage.setItem('sb.announcedChores', JSON.stringify({ '1': [1] }))
    const { client } = setup()
    const group = await screen.findByTestId('chores-group')
    expect(screen.queryByTestId('new-chore-toast')).not.toBeInTheDocument()
    chart = { ...chart, chores: [...chart.chores, mkChore({ choreId: 2, name: 'Water plants' })] }
    await act(async () => {
      await client.invalidateQueries()
    })
    expect(await within(screen.getByTestId('chores-group')).findByRole('region', { name: 'Water plants' })).toBeInTheDocument()
    expect(screen.getByTestId('chores-group')).toBe(group)
    expect(await screen.findByTestId('new-chore-toast')).toHaveTextContent('Water plants')
    expect(play.mock.calls.filter((c) => c[0] === 'chime')).toHaveLength(1)
  })

  it('lives in a polite status region and is a real button with a name', async () => {
    load([mkChore({ choreId: 1, name: 'Feed the dog' })])
    setup()
    const toast = await screen.findByRole('button', { name: /^New chore!\s*Feed the dog$/ })
    expect(toast.tagName).toBe('BUTTON')
    const region = toast.closest('[role="status"]')
    expect(region).not.toBeNull()
    expect(region).toHaveAttribute('aria-live', 'polite')
    // Starts below the offline banner (about 2.5rem tall plus the inset), which is fixed at the top.
    expect(region).toHaveClass('top-[calc(3.25rem+env(safe-area-inset-top))]')
  })

  it('caps the width and truncates a long name after two lines', async () => {
    load([mkChore({ choreId: 1, name: 'W'.repeat(60) })])
    setup()
    const toast = await screen.findByTestId('new-chore-toast')
    expect(toast).toHaveClass('max-w-[min(100%,26rem)]', 'min-h-[72px]')
    expect(within(toast).getByText('W'.repeat(60))).toHaveClass('line-clamp-2')
  })

  describe('a chore that arrives during a celebration', () => {
    async function startFinish(release: { fn: (rejectIt?: boolean) => void }) {
      vi.mocked(celebrateRoutine).mockImplementationOnce(
        () => new Promise<void>((res, rej) => (release.fn = (rejectIt) => (rejectIt ? rej(new Error('x')) : res()))),
      )
      load([mkChore({ choreId: 1, state: 'READY_TO_FINISH', doneCount: 1, tasks: [{ taskId: 100, label: 'Task 1', iconKey: 'broom', done: true }] })])
      localStorage.setItem('sb.announcedChores', JSON.stringify({ '1': [1] }))
      server.use(
        http.post('*/api/children/:c/chores/:id/finish', () => {
          // a new chore appears in the same poll as the finish
          chart = { ...chart, chores: [...chart.chores, mkChore({ choreId: 2, name: 'Water plants' })] }
          return HttpResponse.json({
            chore: mkChore({ choreId: 1, state: 'AWAITING_PICK', doneCount: 1 }),
            pick: { stickerId: 55, childId: 1, chartDate: today(), choices: [], claimed: null, routineName: 'Chore 1', status: 'UNCLAIMED', autoAwarded: false },
            revoked: null,
          })
        }),
      )
      const { client, router } = setup()
      const card = await screen.findByRole('region', { name: 'Chore 1' })
      const done = await within(card).findByRole('button', { name: /I'm Done!/ })
      await new Promise((r) => setTimeout(r, 700))
      await userEvent.click(done)
      await waitFor(() => expect(celebrateRoutine).toHaveBeenCalled())
      await act(async () => {
        await client.invalidateQueries()
      })
      expect(screen.queryByTestId('new-chore-toast')).not.toBeInTheDocument()
      expect(play).not.toHaveBeenCalledWith('chime')
      return router
    }

    it('is announced afterwards when the celebration ends without leaving', async () => {
      const release = { fn: (rejectIt?: boolean) => { void rejectIt } }
      const router = await startFinish(release)
      await act(async () => release.fn(true))
      expect(await screen.findByTestId('new-chore-toast')).toHaveTextContent('Water plants')
      expect(play.mock.calls.filter((c) => c[0] === 'chime')).toHaveLength(1)
      expect(router.state.location.pathname).toBe('/c/1')
    })

    it('is not announced, nor marked, when the finish leads to the pick', async () => {
      const release = { fn: (rejectIt?: boolean) => { void rejectIt } }
      const router = await startFinish(release)
      await act(async () => release.fn())
      await waitFor(() => expect(router.state.location.pathname).toBe('/c/1/pick/55'))
      expect(play).not.toHaveBeenCalledWith('chime')
      expect(JSON.parse(localStorage.getItem('sb.announcedChores') ?? '{}')['1'] ?? []).not.toContain(2)
    })
  })

  it("drops one child's toast on a switch and announces a new chore of the other child", async () => {
    resetFakeApi('default')
    setFakeToday(null)
    const base = getDailyChart(1, today())
    server.use(
      http.get('*/api/children/:childId/days/today', ({ params }) =>
        HttpResponse.json({
          ...base,
          chores: [params.childId === '1' ? mkChore({ choreId: 1, name: 'Feed the dog' }) : mkChore({ choreId: 2, name: 'Water plants' })],
        }),
      ),
    )
    const { router } = setup()
    expect(await screen.findByTestId('new-chore-toast')).toHaveTextContent('Feed the dog')
    await act(async () => {
      await router.navigate('/c/2')
    })
    await waitFor(() => expect(screen.getByTestId('new-chore-toast')).toHaveTextContent('Water plants'))
    expect(screen.queryByText('Feed the dog')).not.toBeInTheDocument()
    expect(play.mock.calls.filter((c) => c[0] === 'chime')).toHaveLength(2)
  })

  describe('two taps in the same frame', () => {
    const finishBody = (pickId: number) => ({
      pick: { stickerId: pickId, childId: 1, chartDate: today(), choices: [], claimed: null, routineName: 'X', status: 'UNCLAIMED', autoAwarded: false },
      revoked: null,
    })

    it('send one chore finish and navigate once', async () => {
      load([mkChore({ choreId: 1, state: 'READY_TO_FINISH', doneCount: 1, tasks: [{ taskId: 100, label: 'Task 1', iconKey: 'broom', done: true }] })])
      let n = 0
      server.use(
        http.post('*/api/children/:c/chores/:id/finish', async () => {
          n++
          await new Promise((r) => setTimeout(r, 50))
          return HttpResponse.json({ chore: mkChore({ choreId: 1, state: 'AWAITING_PICK', doneCount: 1 }), ...finishBody(55) })
        }),
      )
      const { router } = setup()
      const card = await screen.findByRole('region', { name: 'Chore 1' })
      const done = await within(card).findByRole('button', { name: /I'm Done!/ })
      await new Promise((r) => setTimeout(r, 700))
      done.click()
      done.click()
      await waitFor(() => expect(router.state.location.pathname).toBe('/c/1/pick/55'))
      expect(n).toBe(1)
      expect(celebrateRoutine).toHaveBeenCalledTimes(1)
      expect(play.mock.calls.filter((c) => c[0] === 'fanfare')).toHaveLength(1)
    })

    it('send one routine finish and navigate once', async () => {
      load([])
      const r = chart.routines.find((x) => x.state !== 'SKIPPED')!
      chart = {
        ...chart,
        routines: chart.routines.map((x) =>
          x.routineId === r.routineId ? { ...x, state: 'READY_TO_FINISH', doneCount: x.taskCount, tasks: x.tasks.map((t) => ({ ...t, done: true })) } : x,
        ),
      }
      let n = 0
      server.use(
        http.post('*/api/children/:c/days/:d/routines/:id/finish', async () => {
          n++
          await new Promise((res) => setTimeout(res, 50))
          return HttpResponse.json({ routine: r, ...finishBody(56) })
        }),
      )
      const { router } = setup()
      const card = await screen.findByRole('region', { name: r.name })
      const done = await within(card).findByRole('button', { name: /I'm Done!/ })
      await new Promise((res) => setTimeout(res, 700))
      done.click()
      done.click()
      await waitFor(() => expect(router.state.location.pathname).toBe('/c/1/pick/56'))
      expect(n).toBe(1)
      expect(celebrateRoutine).toHaveBeenCalledTimes(1)
    })
  })
})
