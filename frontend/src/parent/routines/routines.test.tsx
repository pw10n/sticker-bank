import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { getFakeState, resetFakeApi, setFakeParentSession, type ScenarioName } from '../../mocks/fakeApi'
import RoutineEditorScreen from './RoutineEditorScreen'
import RoutineListScreen from './RoutineListScreen'
import { moveIndex, scheduleSummary } from './schedule'

function setup(path: string) {
  const router = createMemoryRouter(
    [
      { path: '/parent/children', element: <div>children stub</div> },
      { path: '/parent/children/:childId/routines', element: <RoutineListScreen /> },
      { path: '/parent/routines/:routineId', element: <RoutineEditorScreen /> },
    ],
    { initialEntries: [path] },
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

function start(scenario: ScenarioName = 'default') {
  resetFakeApi(scenario)
  setFakeParentSession(true)
}

beforeEach(() => start())

describe('helpers', () => {
  it('summarises schedules', () => {
    expect(scheduleSummary(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'])).toBe('Every day')
    expect(scheduleSummary(['MON', 'TUE', 'WED', 'THU', 'FRI'])).toBe('Weekdays')
    expect(scheduleSummary(['SUN', 'SAT'])).toBe('Weekends')
    expect(scheduleSummary(['FRI', 'MON', 'WED'])).toBe('Mon, Wed, Fri')
    expect(moveIndex([1, 2, 3], 0, 1)).toEqual([2, 1, 3])
  })
})

describe('RoutineListScreen', () => {
  it('lists routines in order and reorders with Move down', async () => {
    const user = userEvent.setup()
    setup('/parent/children/1/routines')
    const first = await screen.findByRole('heading', { name: 'Morning Routine' })
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(headings).toEqual(['Morning Routine', 'Bedtime'])
    expect(first).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent("Jane Doe's routines")
    await user.click(screen.getByRole('button', { name: 'Move Morning Routine down' }))
    await waitFor(() => {
      const mine = getFakeState()
        .routines.filter((r) => r.childId === 1)
        .sort((a, b) => a.position - b.position)
        .map((r) => r.name)
      expect(mine).toEqual(['Bedtime', 'Morning Routine'])
    })
    await waitFor(() =>
      expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Bedtime', 'Morning Routine']),
    )
  })

  it('skips today and undoes the skip', async () => {
    const user = userEvent.setup()
    setup('/parent/children/1/routines')
    await user.click(await screen.findByRole('button', { name: 'Skip Bedtime today' }))
    await waitFor(() => expect(getFakeState().routines.find((r) => r.id === 2)?.upcomingSkips).toHaveLength(1))
    const undo = await screen.findByRole('button', { name: /Undo skip .* for Bedtime/ })
    await user.click(undo)
    await waitFor(() => expect(getFakeState().routines.find((r) => r.id === 2)?.upcomingSkips).toHaveLength(0))
  })

  it('explains when today is already earned', async () => {
    start('pick-waiting')
    const user = userEvent.setup()
    setup('/parent/children/1/routines')
    await user.click(await screen.findByRole('button', { name: 'Skip Morning Routine today' }))
    expect(await screen.findByText("Today's sticker is already earned")).toBeInTheDocument()
  })

  it('copies a routine to another child', async () => {
    const user = userEvent.setup()
    setup('/parent/children/1/routines')
    await user.click(await screen.findByRole('button', { name: 'Copy Bedtime to…' }))
    expect(screen.getByText('Each child gets their own copy.')).toBeInTheDocument()
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /John Doe/ }))
    await waitFor(() =>
      expect(getFakeState().routines.filter((r) => r.childId === 2 && r.name === 'Bedtime')).toHaveLength(2),
    )
  })

  it('deletes a routine after confirming', async () => {
    const user = userEvent.setup()
    setup('/parent/children/1/routines')
    await user.click(await screen.findByRole('button', { name: 'Delete Bedtime' }))
    expect(screen.getByText('Delete Bedtime? Stickers already earned from it are kept.')).toBeInTheDocument()
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(getFakeState().routines.find((r) => r.id === 2)).toBeUndefined())
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Bedtime' })).not.toBeInTheDocument())
  })
})

describe('RoutineEditorScreen', () => {
  it('creates a routine with all days and two tasks', async () => {
    const user = userEvent.setup()
    const router = setup('/parent/routines/new?childId=2')
    await user.type(await screen.findByLabelText('Routine name'), 'Snack Time')
    for (const day of ['Monday', 'Sunday']) {
      expect(screen.getByRole('button', { name: day })).toHaveAttribute('aria-pressed', 'true')
    }
    expect(screen.getByText('Add at least one task so this routine shows on the chart')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add task' }))
    await user.type(screen.getByLabelText('Task 1'), 'Wash hands')
    await user.click(screen.getByRole('button', { name: 'Add task' }))
    await user.type(screen.getByLabelText('Task 2'), 'Sit down')
    await user.click(screen.getByRole('button', { name: 'Move task 2 up' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/parent/children/2/routines'))
    const created = getFakeState().routines.find((r) => r.name === 'Snack Time')
    expect(created?.childId).toBe(2)
    expect(created?.days).toHaveLength(7)
    expect(created?.tasks.map((t) => t.label)).toEqual(['Sit down', 'Wash hands'])
  })

  it('requires at least one day', async () => {
    const user = userEvent.setup()
    setup('/parent/routines/new?childId=1')
    await user.type(await screen.findByLabelText('Routine name'), 'Nothing')
    for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']) {
      await user.click(screen.getByRole('button', { name: day }))
    }
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Pick at least one day — use Pause to switch a routine off')).toBeInTheDocument()
    expect(getFakeState().routines.find((r) => r.name === 'Nothing')).toBeUndefined()
  })

  it('keeps task ids and shows the start-tomorrow notice when today is earned', async () => {
    start('pick-waiting')
    const user = userEvent.setup()
    const router = setup('/parent/routines/1')
    const task1 = await screen.findByLabelText('Task 1')
    const before = getFakeState().routines.find((r) => r.id === 1)!.tasks.map((t) => t.id)
    await user.clear(task1)
    await user.type(task1, 'Renamed task')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/parent/children/1/routines'))
    expect(await screen.findByText("Today's sticker is already earned. Your changes start tomorrow.")).toBeInTheDocument()
    const after = getFakeState().routines.find((r) => r.id === 1)!
    expect(after.tasks.map((t) => t.id)).toEqual(before)
    expect(after.tasks[0].label).toBe('Renamed task')
    expect(await screen.findByText('Changes start tomorrow')).toBeInTheDocument()
  })

  it('shows a blank-name error and does not save', async () => {
    const user = userEvent.setup()
    setup('/parent/routines/new?childId=1')
    await user.click(await screen.findByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Enter a name')).toBeInTheDocument()
  })
})
