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

  it('navigates to the pick route when the last task earns a sticker', async () => {
    load('one-task-left')
    const router = setup()
    const morning = await screen.findByRole('region', { name: 'Morning Routine' })
    const tile = within(morning).getByRole('button', { pressed: false })
    await userEvent.click(tile)
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
