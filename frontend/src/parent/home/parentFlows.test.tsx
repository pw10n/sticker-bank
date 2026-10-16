import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { getFakeState, resetFakeApi, setFakeParentSession, DEMO_PIN, type ScenarioName } from '../../mocks/fakeApi'
import ParentGuard from '../ParentGuard'
import ParentLayout from '../ParentLayout'
import ParentHomeScreen from './ParentHomeScreen'
import SettingsScreen from '../settings/SettingsScreen'
import WelcomeScreen from '../../welcome/WelcomeScreen'
import { ModeProvider } from '../../app/mode'
import { DeviceSettingsProvider } from '../../app/deviceSettings'

function setup(path: string, scenario: ScenarioName = 'default', session = false) {
  resetFakeApi(scenario)
  setFakeParentSession(session)
  const router = createMemoryRouter(
    [
      { path: '/', element: <p>kids home</p> },
      { path: '/welcome', element: <WelcomeScreen /> },
      {
        path: '/parent',
        element: <ParentGuard />,
        children: [
          {
            element: <ParentLayout />,
            children: [
              { index: true, element: <ParentHomeScreen /> },
              { path: 'settings', element: <SettingsScreen /> },
              { path: 'children/new', element: <p>new child</p> },
            ],
          },
        ],
      },
    ],
    { initialEntries: [path] },
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const utils = render(
    <QueryClientProvider client={client}>
      <DeviceSettingsProvider>
        <ModeProvider>
          <RouterProvider router={router} />
        </ModeProvider>
      </DeviceSettingsProvider>
    </QueryClientProvider>,
  )
  return { router, client, ...utils, user: userEvent.setup() }
}

async function typePin(user: ReturnType<typeof userEvent.setup>, pin: string) {
  for (const d of pin) await user.click(screen.getByRole('button', { name: d }))
}

describe('welcome', () => {
  it('creates a PIN after a mismatch and goes to add the first child', async () => {
    const { user, router } = setup('/welcome', 'fresh-install')
    await screen.findByText('Choose a 4-digit PIN')
    await typePin(user, '1111')
    await screen.findByText('Enter it again')
    await typePin(user, '2222')
    await screen.findByText(/Those didn.t match/)
    expect(screen.getByText('Choose a 4-digit PIN')).toBeInTheDocument()
    await typePin(user, '4321')
    await screen.findByText('Enter it again')
    await typePin(user, '4321')
    await waitFor(() => expect(router.state.location.pathname).toBe('/parent/children/new'))
    expect(getFakeState().settings.pin).toBe('4321')
  })

  it('redirects to /parent when setup is done', async () => {
    const { router } = setup('/welcome')
    await screen.findByText('Grown-ups only')
    expect(router.state.location.pathname).toBe('/parent')
  })
})

describe('ParentGuard', () => {
  it('shows the PIN pad without a session, and the outlet after the right PIN', async () => {
    const { user } = setup('/parent')
    await screen.findByText('Grown-ups only')
    expect(screen.getByText(/Forgot your PIN\?/)).toBeInTheDocument()
    await typePin(user, DEMO_PIN)
    await screen.findByRole('heading', { name: 'Home' })
    expect(screen.getByText('Parent Mode')).toBeInTheDocument()
  })

  it('shows tries left for a wrong PIN, then the countdown on the 5th', async () => {
    const { user } = setup('/parent')
    await screen.findByText('Grown-ups only')
    await typePin(user, '0000')
    await screen.findByText(/4 tries left/)
    await typePin(user, '0000')
    await screen.findByText(/3 tries left/)
    await typePin(user, '0000')
    await screen.findByText(/2 tries left/)
    await typePin(user, '0000')
    await screen.findByText(/1 try left/)
    await typePin(user, '0000')
    await screen.findByText('Try again in 1:00')
    expect(screen.getByRole('button', { name: '1' })).toBeDisabled()
  })

  it('renders the outlet directly when a session exists', async () => {
    setup('/parent', 'default', true)
    await screen.findByRole('heading', { name: 'Home' })
    expect(screen.queryByText('Grown-ups only')).not.toBeInTheDocument()
  })

  it('shows the create flow on a fresh install', async () => {
    setup('/parent', 'fresh-install')
    await screen.findByText('Choose a 4-digit PIN')
  })

  it('Back to kids navigates home', async () => {
    const { user } = setup('/parent')
    await user.click(await screen.findByRole('button', { name: 'Back to kids' }))
    expect(await screen.findByText('kids home')).toBeInTheDocument()
  })
})

describe('ParentLayout', () => {
  it('shows the app and server versions at the bottom', async () => {
    setup('/parent', 'default', true)
    await waitFor(() => expect(screen.getByTestId('version-footer')).toHaveTextContent('App dev · Server mock'))
  })

  it('exits Parent Mode, ends the session and navigates away', async () => {
    const { user } = setup('/parent', 'default', true)
    await user.click(await screen.findByRole('button', { name: 'Exit Parent Mode' }))
    expect(await screen.findByText('kids home')).toBeInTheDocument()
    expect(getFakeState().parentSession).toBe(false)
  })

  it('links to the main sections', async () => {
    setup('/parent', 'default', true)
    const nav = await screen.findByRole('navigation', { name: 'Parent Mode' })
    for (const name of ['Home', 'Children', 'Sticker Library', 'Prizes', 'Settings']) {
      expect(within(nav).getByRole('link', { name: new RegExp(name) })).toBeInTheDocument()
    }
  })
})

describe('ParentHomeScreen', () => {
  it('lists children and the pending prize request', async () => {
    setup('/parent', 'pending-request', true)
    await screen.findByText(/1 prize request from/)
    expect(screen.getByRole('link', { name: 'See prize requests' })).toHaveAttribute('href', '/parent/prizes')
    const first = getFakeState().children[0]
    expect(await screen.findByRole('heading', { name: first.name })).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /Routines for/ }).length).toBeGreaterThan(0)
  })
})

describe('SettingsScreen', () => {
  it('says which version is the app and which is the server in About', async () => {
    setup('/parent/settings', 'default', true)
    expect(await screen.findByText('App version dev')).toBeInTheDocument()
    await screen.findByText('Server version mock')
  })

  it('changes the PIN', async () => {
    const { user } = setup('/parent/settings', 'default', true)
    await user.type(await screen.findByLabelText('Current PIN'), DEMO_PIN)
    await user.type(screen.getByLabelText('New PIN'), '5678')
    await user.type(screen.getByLabelText('Confirm new PIN'), '5678')
    await user.click(screen.getByRole('button', { name: 'Change PIN' }))
    await screen.findByText('Your PIN has been changed.')
    expect(getFakeState().settings.pin).toBe('5678')
  })

  it('rejects a wrong current PIN and mismatched confirmation', async () => {
    const { user } = setup('/parent/settings', 'default', true)
    await user.type(await screen.findByLabelText('Current PIN'), '0000')
    await user.type(screen.getByLabelText('New PIN'), '5678')
    await user.type(screen.getByLabelText('Confirm new PIN'), '5679')
    await user.click(screen.getByRole('button', { name: 'Change PIN' }))
    await screen.findByText(/new PINs don.t match/)
    await user.clear(screen.getByLabelText('Confirm new PIN'))
    await user.type(screen.getByLabelText('Confirm new PIN'), '5678')
    await user.click(screen.getByRole('button', { name: 'Change PIN' }))
    await screen.findByText(/4 tries left/)
    expect(getFakeState().settings.pin).toBe(DEMO_PIN)
  })

  it('updates the time zone and auto-lock', async () => {
    const { user } = setup('/parent/settings', 'default', true)
    const lock = await screen.findByLabelText('Parent Mode auto-lock after')
    await user.selectOptions(lock, '10')
    await user.click(screen.getByRole('button', { name: 'Save settings' }))
    await screen.findByText('Settings saved.')
    expect(getFakeState().settings.idleTimeoutSeconds).toBe(600)
  })

  it('shows version, licenses link, last reset and the install prompt', async () => {
    setup('/parent/settings', 'default', true)
    await screen.findByText('Never')
    expect(screen.getByRole('link', { name: 'Open-source licenses' })).toHaveAttribute('href', '/licenses/')
    expect(screen.queryByText('Install the app')).not.toBeInTheDocument()
    const ev = new Event('beforeinstallprompt', { cancelable: true }) as Event & { prompt: () => Promise<void> }
    ev.prompt = vi.fn(() => Promise.resolve())
    window.dispatchEvent(ev)
    const btn = await screen.findByRole('button', { name: 'Install' })
    btn.click()
    expect(ev.prompt).toHaveBeenCalled()
  })
})
