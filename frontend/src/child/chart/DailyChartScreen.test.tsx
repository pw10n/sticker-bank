import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeviceSettingsProvider } from '../../app/deviceSettings'
import { OnlineStatusProvider } from '../../app/online'
import { http, HttpResponse } from 'msw'
import { server } from '../../mocks/server'
import { getDailyChart } from '../../mocks/fakeState'
import { getFakeState, resetFakeApi, setFakeToday, type ScenarioName } from '../../mocks/fakeApi'
import { addRoutineSkip, today } from '../../mocks/fakeState'
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

function setup(path = '/c/1') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter(
    [
      {
        path: '/c/:childId',
        element: <ChildLayout />,
        children: [
          { index: true, element: <DailyChartScreen /> },
          { path: 'pick/:stickerId', element: <Where /> },
          { path: 'book', element: <Where /> },
        ],
      },
      { path: '/parent', element: <Where /> },
      { path: '/', element: <Where /> },
    ],
    { initialEntries: [path] },
  )
  render(
    <QueryClientProvider client={client}>
      <DeviceSettingsProvider>
        <OnlineStatusProvider>
          <RouterProvider router={router} />
        </OnlineStatusProvider>
      </DeviceSettingsProvider>
    </QueryClientProvider>,
  )
  return router
}

function load(scenario: ScenarioName = 'default') {
  resetFakeApi(scenario)
  setFakeToday(null)
  // The fake API does not resolve the literal 'today' path segment yet; do it here.
  server.use(
    http.get('*/api/children/:childId/days/today', ({ params }) =>
      HttpResponse.json(getDailyChart(Number(params.childId), today())),
    ),
  )
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
  vi.mocked(celebrateRoutine).mockClear()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('DailyChartScreen', () => {
  it("shows Jane's routines with progress", async () => {
    load()
    setup()
    expect(await screen.findByText('2 of 4 done')).toBeInTheDocument()
    const morning = screen.getByRole('region', { name: 'Morning Routine' })
    expect(within(morning).getByRole('button', { name: 'Brush teeth' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Bedtime' })).toBeInTheDocument()
  })

  it('marks a task done and the fake records it', async () => {
    load()
    setup()
    const tiles = await screen.findAllByRole('button', { name: 'Shoes on' })
    const tile = tiles[0]!
    expect(tile).toHaveAttribute('aria-pressed', 'false')
    const before = getFakeState().completions.size + 1
    await userEvent.click(tile)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Shoes on' })).toHaveAttribute('aria-pressed', 'true'))
    await screen.findByText('3 of 4 done')
    expect(getFakeState().completions.size).toBe(before)
  })

  it("checking the last task shows I'm Done! and earns nothing, then tapping it opens the pick", async () => {
    load('one-task-left')
    const router = setup()
    const morning = await screen.findByRole('region', { name: 'Morning Routine' })
    expect(within(morning).queryByRole('button', { name: /I'm Done!/ })).not.toBeInTheDocument()
    await userEvent.click(within(morning).getByRole('button', { pressed: false }))

    const done = await within(morning).findByRole('button', { name: /I'm Done!/ })
    // no sticker, no celebration and no navigation yet (FR-6.6, FR-7.2)
    expect(router.state.location.pathname).toBe('/c/1')
    expect(getFakeState().stickers.filter((s) => s.childId === 1 && s.chartDate === today() && s.status !== 'REVOKED')).toHaveLength(0)
    expect(celebrateRoutine).not.toHaveBeenCalled()

    // the tap that checked the last task cannot also press the button (FR-6.6)
    await userEvent.click(done)
    expect(router.state.location.pathname).toBe('/c/1')
    await new Promise((resolve) => setTimeout(resolve, 700))

    await userEvent.click(done)
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/c\/1\/pick\/\d+$/))
    expect(celebrateRoutine).toHaveBeenCalledTimes(1)
    expect(getFakeState().stickers.filter((s) => s.childId === 1 && s.chartDate === today() && s.finishMode === 'TAPPED')).toHaveLength(1)
  })

  it('a task tapped by mistake is undone while the routine is ready to finish (FR-6.7)', async () => {
    load('ready-to-finish')
    const router = setup()
    const morning = await screen.findByRole('region', { name: 'Morning Routine' })
    expect(await within(morning).findByRole('button', { name: /I'm Done!/ })).toBeInTheDocument()
    expect(within(morning).getByText(/All tasks done/)).toBeInTheDocument()

    await userEvent.click(within(morning).getByRole('button', { name: 'Shoes on' }))
    await waitFor(() => expect(within(morning).queryByRole('button', { name: /I'm Done!/ })).not.toBeInTheDocument())
    expect(within(morning).getByText('3 of 4 done')).toBeInTheDocument()
    expect(within(morning).getByRole('button', { name: 'Shoes on' })).toHaveAttribute('aria-pressed', 'false')
    expect(router.state.location.pathname).toBe('/c/1')
    expect(getFakeState().stickers.filter((s) => s.childId === 1 && s.chartDate === today() && s.status !== 'REVOKED')).toHaveLength(0)

    // checking it again brings the button back (after the tile's own 600 ms double-tap guard)
    await new Promise((resolve) => setTimeout(resolve, 700))
    await userEvent.click(within(morning).getByRole('button', { name: 'Shoes on' }))
    expect(await within(morning).findByRole('button', { name: /I'm Done!/ })).toBeInTheDocument()
  })

  it('keeps the button after a reload, since the state comes from the saved tasks (FR-6.9)', async () => {
    load('ready-to-finish')
    setup()
    const morning = await screen.findByRole('region', { name: 'Morning Routine' })
    expect(await within(morning).findByRole('button', { name: /I'm Done!/ })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Morning Routine' })).toHaveAttribute('data-highlighted', 'true')
  })

  it('reloads quietly when another device unchecked a task before I\'m Done! (ROUTINE_NOT_READY)', async () => {
    load('ready-to-finish')
    const router = setup()
    const morning = await screen.findByRole('region', { name: 'Morning Routine' })
    const done = await within(morning).findByRole('button', { name: /I'm Done!/ })
    // a parent's device unchecks a task behind the child's back
    const routine = getFakeState().routines.find((r) => r.childId === 1 && r.name === 'Morning Routine')!
    getFakeState().completions.delete(`${routine.tasks[0].id}|${today()}`)
    await new Promise((resolve) => setTimeout(resolve, 700))
    await userEvent.click(done)
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Morning Routine' })).queryByRole('button', { name: /I'm Done!/ })).not.toBeInTheDocument())
    expect(router.state.location.pathname).toBe('/c/1')
    expect(celebrateRoutine).not.toHaveBeenCalled()
  })

  it('an auto-finished sticker from yesterday waits in the tray, without a celebration (FR-6.10)', async () => {
    load('auto-finished')
    const router = setup()
    const tray = await screen.findByRole('region', { name: 'Stickers to pick' })
    const link = within(tray).getByRole('link', { name: /Pick your sticker!/ })
    expect(link).toHaveTextContent('Yesterday')
    expect(celebrateRoutine).not.toHaveBeenCalled()
    await userEvent.click(link)
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/c\/1\/pick\/\d+$/))
  })

  it('shows the pick button and locks tiles when a pick is waiting', async () => {
    load('pick-waiting')
    setup()
    const link = await screen.findByRole('link', { name: /Pick your sticker!/ })
    expect(link).toHaveAttribute('href', expect.stringMatching(/^\/c\/1\/pick\/\d+$/))
    for (const name of ['Brush teeth', 'Get dressed', 'Eat breakfast', 'Shoes on']) {
      expect(within(screen.getByRole('region', { name: 'Morning Routine' })).getByRole('button', { name })).toBeDisabled()
    }
  })

  it('hides skipped routines', async () => {
    load()
    addRoutineSkip(2, today())
    setup()
    await screen.findByText('2 of 4 done')
    expect(screen.queryByRole('region', { name: 'Bedtime' })).not.toBeInTheDocument()
  })

  it('shows a friendly empty state when nothing is left', async () => {
    load()
    addRoutineSkip(1, today())
    addRoutineSkip(2, today())
    setup()
    expect(await screen.findByText(/No routines today/)).toBeInTheDocument()
  })

  it("shows the tray with John's unclaimed sticker", async () => {
    load()
    const router = setup('/c/2')
    const tray = await screen.findByRole('region', { name: 'Stickers to pick' })
    const link = within(tray).getByRole('link', { name: /Pick your sticker!/ })
    expect(link).toHaveTextContent('Yesterday')
    await userEvent.click(link)
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/c\/2\/pick\/\d+$/))
  })

  it('disables tiles when writes are not possible', async () => {
    load()
    setup()
    const tile = await screen.findByRole('button', { name: 'Shoes on' })
    ;(getFakeState() as { offline: boolean }).offline = true
    await userEvent.click(tile)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Shoes on' })).toBeDisabled())
    expect(screen.getByRole('button', { name: 'Shoes on' })).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('ChildLayout', () => {
  it('switches children from the top bar', async () => {
    load()
    const router = setup()
    await screen.findByText('2 of 4 done')
    await userEvent.click(screen.getByRole('button', { name: 'John Doe' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/c/2'))
    expect(screen.getByRole('button', { name: 'John Doe' })).toHaveAttribute('aria-current', 'true')
  })

  it('remembers the child and has the nav buttons', async () => {
    load()
    const router = setup()
    await screen.findByText('2 of 4 done')
    expect(localStorage.getItem('sb.lastChildId')).toBe('1')
    await userEvent.click(screen.getByRole('link', { name: /Sticker Book/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/c/1/book'))
  })

  it('goes to the picker for an unknown child', async () => {
    load()
    const router = setup('/c/999')
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })

  it('needs a 1 second hold for Parent Mode', async () => {
    load()
    const router = setup()
    await screen.findByText('2 of 4 done')
    const btn = screen.getByRole('button', { name: 'Parent Mode' })
    vi.useFakeTimers()
    fireEvent.pointerDown(btn)
    act(() => void vi.advanceTimersByTime(300))
    fireEvent.pointerUp(btn)
    act(() => void vi.advanceTimersByTime(1500))
    expect(router.state.location.pathname).toBe('/c/1')
    fireEvent.pointerDown(btn)
    act(() => void vi.advanceTimersByTime(1000))
    fireEvent.pointerUp(btn)
    expect(router.state.location.pathname).toBe('/parent')
  })
})
