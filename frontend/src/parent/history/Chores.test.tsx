import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ChartChore, ChartRoutine, ChoreResult, DailyChart, History, HistoryChore } from '../../api/types'
import { resetFakeApi, setFakeParentSession } from '../../mocks/fakeApi'
import { server } from '../../mocks/server'
import { addDays } from './dates'
import { DayDetail } from './DayDetail'
import HistoryScreen from './HistoryScreen'

function localToday(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const TODAY = localToday()
const PAST = addDays(TODAY, -1)

beforeEach(() => {
  resetFakeApi()
  setFakeParentSession(true)
})

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function historyChore(over: Partial<HistoryChore> = {}): HistoryChore {
  return {
    choreId: 7,
    name: 'Wash the car',
    iconKey: 'car',
    state: 'EARNED',
    doneCount: 2,
    taskCount: 2,
    stickerId: 50,
    autoFinished: false,
    ...over,
  }
}

function chartChore(over: Partial<ChartChore> = {}): ChartChore {
  return {
    choreId: 7,
    name: 'Wash the car',
    iconKey: 'car',
    state: 'EARNED',
    doneCount: 2,
    taskCount: 2,
    dueDate: null,
    sticker: {
      stickerId: 50,
      status: 'AVAILABLE',
      design: { designId: 5, name: 'Happy Frog', artworkKey: 'sticker-frog' },
      prizeRequestId: null,
      revocable: true,
      autoFinished: false,
    },
    tasks: [
      { taskId: 71, label: 'Soap it', iconKey: 'soap', done: true },
      { taskId: 72, label: 'Rinse it', iconKey: 'water', done: true },
    ],
    ...over,
  }
}

function chartRoutine(over: Partial<ChartRoutine> = {}): ChartRoutine {
  return {
    routineId: 7,
    name: 'Morning Routine',
    iconKey: 'sun',
    color: null,
    state: 'IN_PROGRESS',
    doneCount: 1,
    taskCount: 2,
    sticker: null,
    tasks: [
      { taskId: 71, label: 'Brush teeth', iconKey: 'tooth', done: true },
      { taskId: 72, label: 'Get dressed', iconKey: 'shirt', done: false },
    ],
    ...over,
  }
}

function dayChart(date: string, chores: ChartChore[], routines: ChartRoutine[] = []): DailyChart {
  return { childId: 1, date, isToday: date === TODAY, routines, chores, unclaimedFromEarlierDays: [] }
}

describe('History calendar chores', () => {
  function renderScreen(history: History) {
    server.use(http.get('*/api/parent/children/:childId/history', () => HttpResponse.json(history)))
    const router = createMemoryRouter([{ path: '/parent/history/:childId', element: <HistoryScreen /> }], {
      initialEntries: ['/parent/history/1'],
    })
    render(
      <QueryClientProvider client={client()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )
  }

  it('lists chores under routines with badges and the automatic mark, and keeps them out of the summary', async () => {
    renderScreen({
      childId: 1,
      days: [
        {
          date: TODAY,
          revocations: [],
          routines: [
            { routineId: 7, name: 'Morning Routine', iconKey: 'sun', state: 'EARNED', doneCount: 2, taskCount: 2, stickerId: 1, autoFinished: false },
          ],
          chores: [
            historyChore({ autoFinished: true }),
            historyChore({ choreId: 8, name: 'Tidy shed', state: 'MISSED', doneCount: 0, taskCount: 3, stickerId: null }),
          ],
        },
      ],
    } as unknown as History)
    const card = await screen.findByTestId(`day-${TODAY}`)
    const chore = await within(card).findByTestId('day-chore-7')
    expect(within(chore).getByText('Wash the car')).toBeInTheDocument()
    expect(within(chore).getByText('Earned')).toBeInTheDocument()
    expect(within(chore).getByTestId('auto-finished-mark')).toHaveTextContent('Finished automatically')
    const missed = within(card).getByTestId('day-chore-8')
    expect(within(missed).getByText(/Missed/)).toBeInTheDocument()
    expect(within(card).queryByText('No routines')).not.toBeInTheDocument()
    const summary = screen.getByRole('list', { name: 'Week summary' })
    expect(within(summary).getByText(/Morning Routine/)).toBeInTheDocument()
    expect(within(summary).queryByText(/Wash the car/)).not.toBeInTheDocument()
    expect(within(summary).queryByText(/Tidy shed/)).not.toBeInTheDocument()
  })

  it('shows "No routines" only when a day has neither routines nor chores', async () => {
    renderScreen({
      childId: 1,
      days: [
        { date: TODAY, revocations: [], routines: [], chores: [historyChore()] },
        { date: PAST, revocations: [], routines: [], chores: [] },
      ],
    } as unknown as History)
    const today = await screen.findByTestId(`day-${TODAY}`)
    await within(today).findByTestId('day-chore-7')
    expect(within(today).queryByText('No routines')).not.toBeInTheDocument()
    const past = screen.queryByTestId(`day-${PAST}`)
    // PAST can fall in the previous week on a Monday; only check when it is shown.
    if (past) expect(within(past).getByText('No routines')).toBeInTheDocument()
  })
})

describe('Day detail chores', () => {
  let chart: DailyChart
  let deletes: URL[]
  let bodies: unknown[]

  function renderDay(date: string, opts: { result?: (c: DailyChart) => ChoreResult; status?: number } = {}) {
    deletes = []
    bodies = []
    server.use(
      http.get('*/api/children/:childId/days/:date', () => HttpResponse.json(chart)),
      http.delete('*/api/children/:childId/chores/:choreId/tasks/:taskId', async ({ request }) => {
        deletes.push(new URL(request.url))
        bodies.push(await request.json().catch(() => null))
        if (opts.status) {
          return HttpResponse.json({ title: 'Conflict', status: opts.status, code: 'STICKER_USED' }, { status: opts.status })
        }
        const result = opts.result?.(chart) ?? { chore: chartChore({ state: 'IN_PROGRESS', sticker: null, doneCount: 1 }), pick: null, revoked: null }
        if (result.chore) chart = { ...chart, chores: [result.chore] }
        else chart = { ...chart, chores: [] }
        return HttpResponse.json(result)
      }),
    )
    let changed = 0
    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: <DayDetail childId={1} childName="Jane Doe" date={date} onClose={() => {}} onChanged={() => void changed++} />,
        },
        { path: '/parent/chores', element: <p>chores page</p> },
      ],
      { initialEntries: ['/'] },
    )
    render(
      <QueryClientProvider client={client()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )
    return { changed: () => changed }
  }

  it('shows a finished chore with its sticker review, due date and Uncheck controls', async () => {
    chart = dayChart(PAST, [chartChore({ dueDate: TODAY })])
    renderDay(PAST)
    const section = await screen.findByRole('region', { name: 'Chores' })
    const item = within(section).getByRole('listitem', { name: 'Wash the car' })
    expect(within(item).getByText(/Due /)).toBeInTheDocument()
    expect(within(item).getByText('2 of 2 done', { exact: false })).toBeInTheDocument()
    expect(within(item).getByTestId('sticker-status')).toHaveTextContent('Available')
    expect(within(item).getByText('Happy Frog')).toBeInTheDocument()
    expect(within(item).getAllByText('Uncheck')).toHaveLength(2)
    expect(screen.queryByText('No routines on this day.')).not.toBeInTheDocument()
  })

  it('shows a pending-pick chore as "Not picked yet" and the automatic chip', async () => {
    chart = dayChart(PAST, [
      chartChore({
        state: 'AWAITING_PICK',
        sticker: { stickerId: 50, status: 'UNCLAIMED', design: null, prizeRequestId: null, revocable: true, autoFinished: true },
      }),
    ])
    renderDay(PAST)
    expect(await screen.findByText('Not picked yet')).toBeInTheDocument()
    expect(screen.getByTestId('sticker-auto-finished')).toHaveTextContent('Finished automatically')
  })

  it('shows an unfinished chore read-only on today with a Manage chores link', async () => {
    chart = dayChart(
      TODAY,
      [chartChore({ state: 'IN_PROGRESS', sticker: null, doneCount: 1, tasks: [
        { taskId: 71, label: 'Soap it', iconKey: 'soap', done: true },
        { taskId: 72, label: 'Rinse it', iconKey: 'water', done: false },
      ] })],
    )
    renderDay(TODAY)
    const item = await screen.findByRole('listitem', { name: 'Wash the car' })
    expect(within(item).queryByRole('button')).not.toBeInTheDocument()
    expect(within(item).getByText(/Soap it/)).toBeInTheDocument()
    expect(within(item).getByText('(done)')).toBeInTheDocument()
    expect(within(item).getByText('(not done)')).toBeInTheDocument()
    const link = within(item).getByRole('link', { name: 'Manage chores' })
    expect(link).toHaveAttribute('href', '/parent/chores?child=1')
  })

  it('shows a missed chore read-only with the Missed badge and no link', async () => {
    chart = dayChart(PAST, [chartChore({ state: 'MISSED', sticker: null, doneCount: 1, dueDate: PAST })])
    renderDay(PAST)
    const item = await screen.findByRole('listitem', { name: 'Wash the car' })
    expect(within(item).getByText(/Missed/)).toBeInTheDocument()
    expect(within(item).queryByRole('button')).not.toBeInTheDocument()
    expect(within(item).queryByRole('link')).not.toBeInTheDocument()
  })

  it('revokes through the shared sheet with the back-on-the-chart line and refreshes', async () => {
    chart = dayChart(PAST, [chartChore()])
    const { changed } = renderDay(PAST)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /Soap it/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Remove this sticker?' })
    expect(dialog.textContent).toContain("Unchecking 'Soap it' in Wash the car on")
    expect(dialog.textContent).toContain("The chore won't be finished")
    expect(within(dialog).getByText("Wash the car will go back on Jane Doe's chart.")).toBeInTheDocument()
    const box = within(dialog).getByRole('checkbox', { name: 'Remove this chore too' })
    expect(box).not.toBeChecked()
    await user.click(within(dialog).getByRole('button', { name: 'Remove sticker' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Remove this sticker?' })).not.toBeInTheDocument())
    expect(deletes).toHaveLength(1)
    expect(deletes[0].pathname).toMatch(/\/chores\/7\/tasks\/71$/)
    expect(deletes[0].searchParams.get('revokeSticker')).toBe('true')
    expect(deletes[0].searchParams.get('removeChore')).toBeNull()
    expect(screen.getByText('Sticker removed.')).toBeInTheDocument()
    expect(changed()).toBe(1)
    // The day refreshed: the chore is in progress and read-only now.
    await waitFor(() => expect(screen.queryByText('Uncheck')).not.toBeInTheDocument())
  })

  it('says the chore will show as Missed when its due date has passed', async () => {
    chart = dayChart(PAST, [chartChore({ dueDate: PAST })])
    renderDay(PAST)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /Soap it/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Remove this sticker?' })
    expect(within(dialog).getByText('Its due date has passed, so it will show as Missed.')).toBeInTheDocument()
  })

  it('sends removeChore when the box is ticked and the line says it will be removed', async () => {
    chart = dayChart(PAST, [chartChore({ dueDate: PAST })])
    renderDay(PAST, { result: () => ({ chore: null, pick: null, revoked: null }) })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /Rinse it/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Remove this sticker?' })
    await user.click(within(dialog).getByRole('checkbox', { name: 'Remove this chore too' }))
    expect(within(dialog).getByText('Wash the car will be removed.')).toBeInTheDocument()
    expect(within(dialog).queryByText(/due date has passed/)).not.toBeInTheDocument()
    await user.type(within(dialog).getByLabelText('Note (optional)'), 'Not really done')
    await user.click(within(dialog).getByRole('button', { name: 'Remove sticker' }))
    await waitFor(() => expect(deletes).toHaveLength(1))
    expect(deletes[0].pathname).toMatch(/\/chores\/7\/tasks\/72$/)
    expect(deletes[0].searchParams.get('removeChore')).toBe('true')
    expect(bodies[0]).toEqual({ note: 'Not really done' })
    expect(await screen.findByText('Sticker removed.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Chores' })).not.toBeInTheDocument())
  })

  it('disables Uncheck with the explanation when the sticker is Used', async () => {
    const base = chartChore()
    chart = dayChart(PAST, [{ ...base, sticker: { ...base.sticker!, status: 'USED', revocable: false } }])
    renderDay(PAST)
    const btn = await screen.findByRole('button', { name: /Soap it/ })
    expect(btn).toBeDisabled()
    expect(within(btn).queryByText('Uncheck')).not.toBeInTheDocument()
    expect(screen.getByText("This sticker was already spent on a prize, so it can't be taken back.")).toBeInTheDocument()
    expect(btn).toHaveAccessibleDescription(/already spent/)
  })

  it('shows the blocked state when the server answers STICKER_USED', async () => {
    chart = dayChart(PAST, [chartChore()])
    renderDay(PAST, { status: 409 })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /Soap it/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Remove this sticker?' })
    await user.click(within(dialog).getByRole('button', { name: 'Remove sticker' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent("can't be taken back")
    expect(within(dialog).queryByRole('button', { name: 'Remove sticker' })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'OK' })).toBeInTheDocument()
  })

  it('keeps a routine and a chore with the same id apart', async () => {
    chart = dayChart(PAST, [chartChore({ choreId: 7 })], [
      chartRoutine({ routineId: 7 }),
    ])
    renderDay(PAST)
    const user = userEvent.setup()
    const routineItem = await screen.findByRole('listitem', { name: 'Morning Routine' })
    const choreItem = screen.getByRole('listitem', { name: 'Wash the car' })
    expect(within(routineItem).getByText('Brush teeth', { exact: false })).toBeInTheDocument()
    expect(within(choreItem).queryByText('Brush teeth', { exact: false })).not.toBeInTheDocument()
    // Unchecking the chore's task hits the chore endpoint only.
    await user.click(within(choreItem).getByRole('button', { name: /Soap it/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Remove this sticker?' })
    await user.click(within(dialog).getByRole('button', { name: 'Remove sticker' }))
    await waitFor(() => expect(deletes).toHaveLength(1))
    expect(deletes[0].pathname).toMatch(/\/chores\/7\/tasks\/71$/)
    // The routine is untouched and still shows its own tasks.
    await waitFor(() => expect(screen.getByRole('listitem', { name: 'Morning Routine' })).toBeInTheDocument())
  })
})
