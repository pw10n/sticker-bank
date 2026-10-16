import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it } from 'vitest'
import { resetFakeApi, setFakeParentSession, type ScenarioName } from '../../mocks/fakeApi'
import { addDays, dayLabel, weekStart } from './dates'
import HistoryScreen from './HistoryScreen'

function localToday(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function setup(scenario: ScenarioName = 'default') {
  resetFakeApi(scenario)
  setFakeParentSession(true)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter(
    [
      { path: '/parent/history/:childId', element: <HistoryScreen /> },
      { path: '/parent/children', element: <p>children stub</p> },
      { path: '/c/:childId/pick/:stickerId', element: <p>pick stub</p> },
    ],
    { initialEntries: ['/parent/history/1'] },
  )
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { router }
}

async function openAgo(ago: number) {
  const user = userEvent.setup()
  const today = localToday()
  const date = addDays(today, -ago)
  await screen.findByText(/Jane Doe/)
  if (date < weekStart(today)) {
    await user.click(screen.getByRole('button', { name: 'Previous week' }))
  }
  await user.click(await screen.findByRole('button', { name: `Open ${dayLabel(date)}` }))
  return { user, dialog: await screen.findByRole('dialog') }
}

describe('HistoryScreen', () => {
  it('renders 7 days with state badges and a legend', async () => {
    setup()
    expect(await screen.findAllByTestId(/^day-/)).toHaveLength(7)
    expect(screen.getByRole('list', { name: 'Legend' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getAllByText(/Earned|Missed/).length).toBeGreaterThan(0))
    expect(screen.getByRole('button', { name: 'Next week' })).toBeDisabled()
  })

  it('navigates to the previous week and fetches older days', async () => {
    setup()
    const user = userEvent.setup()
    const prev = await screen.findByRole('button', { name: 'Previous week' })
    const startBefore = weekStart(localToday())
    await user.click(prev)
    const older = addDays(startBefore, -7)
    await waitFor(() => expect(screen.getByTestId(`day-${older}`)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Next week' })).toBeEnabled()
  })

  it('does not make future days clickable', async () => {
    setup()
    const today = localToday()
    await screen.findAllByTestId(/^day-/)
    const future = addDays(today, 1)
    if (weekStart(future) === weekStart(today)) {
      expect(screen.queryByRole('button', { name: `Open ${dayLabel(future)}` })).toBeNull()
    }
    expect(screen.getByRole('button', { name: `Open ${dayLabel(today)}` })).toBeInTheDocument()
  })

  it('shows yesterday routines in the day sheet', async () => {
    setup()
    const { dialog } = await openAgo(1)
    expect(await within(dialog).findByText('Morning Routine')).toBeInTheDocument()
    expect(within(dialog).getAllByText(/Sticker earned — locked/).length).toBeGreaterThan(0)
  })

  it("checking the last task of a missed past routine leaves it ready to finish, and I'm Done! earns the sticker", async () => {
    const { router } = setup()
    const { user, dialog } = await openAgo(3)
    const routine = await within(dialog).findByRole('listitem', { name: 'Morning Routine' })
    for (let i = 0; i < 3; i++) {
      const next = within(routine).getAllByRole('button', { pressed: false })[0]
      await user.click(next)
      await waitFor(() => expect(next).toHaveAttribute('aria-pressed', 'true'))
    }
    // FR-6.5, FR-7.1: the last check earns nothing. The parent taps I'm Done! for the child.
    const done = await within(routine).findByRole('button', { name: /I'm Done!/ })
    expect(within(routine).getByText(/All tasks done/)).toBeInTheDocument()
    expect(screen.queryByText(/earned a sticker/)).not.toBeInTheDocument()
    await user.click(done)
    expect(await screen.findByText(/Jane Doe earned a sticker for Morning Routine/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Later/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Let Jane Doe pick now' }))
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/c\/1\/pick\//))
  })

  it('a ready-to-finish routine unchecks freely, with no confirm sheet (BR-19)', async () => {
    setup()
    const { user, dialog } = await openAgo(3)
    const routine = await within(dialog).findByRole('listitem', { name: 'Morning Routine' })
    for (let i = 0; i < 3; i++) {
      const next = within(routine).getAllByRole('button', { pressed: false })[0]
      await user.click(next)
      await waitFor(() => expect(next).toHaveAttribute('aria-pressed', 'true'))
    }
    await within(routine).findByRole('button', { name: /I'm Done!/ })
    const checked = within(routine).getAllByRole('button', { pressed: true })[0]
    await user.click(checked)
    await waitFor(() => expect(within(routine).queryByRole('button', { name: /I'm Done!/ })).not.toBeInTheDocument())
    expect(screen.queryByRole('dialog', { name: 'Remove this sticker?' })).not.toBeInTheDocument()
  })

  it('keeps toggles serialized so rapid taps still end with the earned panel', async () => {
    setup()
    const { dialog } = await openAgo(3)
    const routine = await within(dialog).findByRole('listitem', { name: 'Morning Routine' })
    const buttons = within(routine).getAllByRole('button', { pressed: false })
    const tasks = buttons.slice(0, 3)
    for (const b of tasks) fireEvent.click(b) // rapid, no waiting between taps
    await waitFor(() => {
      for (const b of tasks) {
        if (b.getAttribute('aria-pressed') !== 'true' && !b.hasAttribute('disabled')) fireEvent.click(b)
      }
      expect(tasks.every((b) => b.getAttribute('aria-pressed') === 'true')).toBe(true)
    })
    expect(await within(routine).findByRole('button', { name: /I'm Done!/ })).toBeInTheDocument()
    expect(screen.queryByText(/earned a sticker/)).not.toBeInTheDocument()
  })

  it('marks a sticker the day\'s end earned as finished automatically, in the calendar and the review', async () => {
    setup('auto-finished')
    // the calendar marks the day (FR-6.11)
    await waitFor(() => expect(screen.getAllByTestId('auto-finished-mark').length).toBeGreaterThan(0))
    const { dialog } = await openAgo(1)
    const routine = await within(dialog).findByRole('listitem', { name: 'Morning Routine' })
    expect(within(routine).getByTestId('sticker-auto-finished')).toHaveTextContent('Finished automatically')
    expect(within(routine).getByTestId('sticker-status')).toHaveTextContent('Unclaimed')
  })

  it('does not mark a sticker the child finished by tapping', async () => {
    setup()
    const { dialog } = await openAgo(1)
    const routine = await within(dialog).findByRole('listitem', { name: 'Morning Routine' })
    expect(within(routine).queryByTestId('sticker-auto-finished')).not.toBeInTheDocument()
    expect(screen.queryByTestId('auto-finished-mark')).not.toBeInTheDocument()
  })

  it('skips today and un-skips', async () => {
    setup()
    const { user, dialog } = await openAgo(0)
    const routine = await within(dialog).findByRole('listitem', { name: 'Morning Routine' })
    await user.click(within(routine).getByRole('button', { name: 'Skip this day' }))
    await user.click(await within(routine).findByRole('button', { name: 'Un-skip' }))
    expect(await within(routine).findByRole('button', { name: 'Skip this day' })).toBeInTheDocument()
  })
})
