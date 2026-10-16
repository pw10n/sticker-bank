import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeviceSettingsProvider } from '../../app/deviceSettings'
import { getFakeState, resetFakeApi, type ScenarioName } from '../../mocks/fakeApi'
import ChildPickerScreen from '../ChildPickerScreen'

function memoryStorage(seed: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(seed))
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

function setup(scenario: ScenarioName, seed: Record<string, string> = {}, tweak?: () => void) {
  vi.stubGlobal('localStorage', memoryStorage(seed))
  resetFakeApi(scenario)
  tweak?.()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter(
    [
      { path: '/', element: <ChildPickerScreen /> },
      { path: '/c/:childId', element: <Where /> },
      { path: '/welcome', element: <Where /> },
      { path: '/parent', element: <Where /> },
    ],
    { initialEntries: ['/'] },
  )
  render(
    <QueryClientProvider client={client}>
      <DeviceSettingsProvider>
        <RouterProvider router={router} />
      </DeviceSettingsProvider>
    </QueryClientProvider>,
  )
  return router
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('ChildPickerScreen', () => {
  it('redirects to the last child', async () => {
    const router = setup('default', { 'sb.lastChildId': '2' })
    await waitFor(() => expect(router.state.location.pathname).toBe('/c/2'))
  })

  it('shows the app and server versions at the bottom', async () => {
    setup('default')
    await screen.findByRole('button', { name: /John Doe/ })
    await waitFor(() => expect(screen.getByTestId('version-footer')).toHaveTextContent('App dev · Server mock'))
  })

  it('lists children and navigates on selection', async () => {
    const router = setup('default')
    await userEvent.click(await screen.findByRole('button', { name: /John Doe/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/c/2'))
    expect(localStorage.getItem('sb.lastChildId')).toBe('2')
  })

  it('shows the picker when the stored child no longer exists', async () => {
    setup('default', { 'sb.lastChildId': '99' })
    expect(await screen.findByRole('button', { name: /Jane Doe/ })).toBeInTheDocument()
  })

  it('goes to /welcome on a fresh install', async () => {
    const router = setup('fresh-install')
    await waitFor(() => expect(router.state.location.pathname).toBe('/welcome'))
  })

  it('offers Parent Mode when there are no children but a PIN exists', async () => {
    const router = setup('default', {}, () => {
      getFakeState().children.length = 0
    })
    expect(await screen.findByText('Ask a grown-up to add you!')).toBeInTheDocument()
    const btn = screen.getByRole('button', { name: 'Parent Mode' })
    vi.useFakeTimers()
    fireEvent.pointerDown(btn)
    act(() => void vi.advanceTimersByTime(1000))
    fireEvent.pointerUp(btn)
    expect(router.state.location.pathname).toBe('/parent')
  })

  it('shows Parent Mode with the badge on the picker when children exist', async () => {
    const router = setup('pending-request', { 'sb.lastChildId': '99' })
    expect(await screen.findByRole('button', { name: /Jane Doe/ })).toBeInTheDocument()
    const btn = screen.getByRole('button', { name: 'Parent Mode', description: /1/ })
    vi.useFakeTimers()
    fireEvent.pointerDown(btn)
    act(() => void vi.advanceTimersByTime(300))
    fireEvent.pointerUp(btn)
    expect(router.state.location.pathname).toBe('/')
    fireEvent.pointerDown(btn)
    act(() => void vi.advanceTimersByTime(1000))
    fireEvent.pointerUp(btn)
    expect(router.state.location.pathname).toBe('/parent')
  })
})
