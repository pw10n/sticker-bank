import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it } from 'vitest'
import { DeviceSettingsProvider } from '../../app/deviceSettings'
import { ModeProvider } from '../../app/mode'
import { bootstrapFixture, mockBootstrap } from '../../app/testUtils'
import type { ChartSticker, Chore, ChoreInput, ChorePage, ChoreSuggestion } from '../../api/types'
import { server } from '../../mocks/server'
import ChoresScreen from './ChoresScreen'

const TODAY = '2030-01-01'
const JANE = { id: 1, name: 'Jane Doe', position: 0, avatarKey: 'avatar-fox', themeColor: '#FB8500' }
const JOHN = { id: 2, name: 'John Doe', position: 1, avatarKey: 'avatar-fox', themeColor: '#2A9D8F' }

function sticker(over: Partial<ChartSticker> = {}): ChartSticker {
  return {
    stickerId: 90,
    status: 'AVAILABLE',
    design: { designId: 5, name: 'Happy Frog', artworkKey: 'sticker-frog' },
    prizeRequestId: null,
    revocable: true,
    autoFinished: false,
    ...over,
  }
}

function chore(over: Partial<Chore> = {}): Chore {
  return {
    choreId: 10,
    childId: 1,
    name: 'Wash the car',
    iconKey: 'broom',
    dueDate: null,
    state: 'IN_PROGRESS',
    doneCount: 1,
    taskCount: 2,
    closedOn: null,
    createdAt: '2030-01-01T08:00:00Z',
    sticker: null,
    tasks: [
      { taskId: 101, label: 'Soap', iconKey: 'broom', done: true },
      { taskId: 102, label: 'Rinse', iconKey: 'broom', done: false },
    ],
    ...over,
  }
}

function finished(over: Partial<Chore> = {}): Chore {
  return chore({
    choreId: 20,
    name: 'Tidy the shed',
    state: 'EARNED',
    doneCount: 2,
    closedOn: '2029-12-30',
    sticker: sticker(),
    tasks: [
      { taskId: 201, label: 'Sweep', iconKey: 'broom', done: true },
      { taskId: 202, label: 'Stack', iconKey: 'broom', done: true },
    ],
    ...over,
  })
}

interface Api {
  active: Chore[]
  closed: Chore[]
  recent: ChoreSuggestion[]
  calls: { method: string; url: string; body?: unknown }[]
}

function mockApi(init: Partial<Api> = {}, children = [JANE, JOHN]): Api {
  const api: Api = { active: [], closed: [], recent: [], calls: [], ...init }
  mockBootstrap(() => bootstrapFixture({ today: TODAY, children }))
  server.use(
    http.get('*/api/parent/chores/recent', () => HttpResponse.json(api.recent)),
    http.get('*/api/parent/chores', ({ request }) => {
      const url = new URL(request.url)
      const childId = Number(url.searchParams.get('childId'))
      const src = url.searchParams.get('filter') === 'closed' ? api.closed : api.active
      const items = childId ? src.filter((c) => c.childId === childId) : src
      api.calls.push({ method: 'GET', url: url.pathname + url.search })
      return HttpResponse.json({ items, nextCursor: null } satisfies ChorePage)
    }),
    http.get('*/api/children/:childId/prize-requests/pending', () => HttpResponse.json({ request: null })),
  )
  return api
}

function setup(path = '/parent/chores') {
  const router = createMemoryRouter(
    [
      { path: '/parent/chores', element: <ChoresScreen /> },
      { path: '/c/:childId/pick/:stickerId', element: <p>pick screen</p> },
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
  return { router, ...utils, user: userEvent.setup() }
}

function capture(api: Api, method: 'post' | 'put' | 'delete', pattern: string, respond: (body: ChoreInput) => Response) {
  server.use(
    http[method](pattern, async ({ request }) => {
      const body = request.method === 'DELETE' ? undefined : ((await request.json()) as ChoreInput)
      api.calls.push({ method: request.method, url: new URL(request.url).pathname, body })
      return respond(body as ChoreInput)
    }),
  )
}

const problem = (status: number, code: string, extra: object = {}) =>
  HttpResponse.json({ status, code, title: code, ...extra }, { status, headers: { 'Content-Type': 'application/problem+json' } })

describe('Chores page lists', () => {
  it('shows to-do chores grouped by child, and closed chores', async () => {
    mockApi({
      active: [chore(), chore({ choreId: 11, childId: 2, name: 'Water plants', dueDate: TODAY, tasks: [{ taskId: 111, label: 'Water plants', iconKey: 'broom', done: false }], doneCount: 0, taskCount: 1, state: 'NOT_STARTED' })],
      closed: [finished(), chore({ choreId: 30, name: 'Old job', state: 'MISSED', closedOn: '2029-12-25', dueDate: '2029-12-25' })],
    })
    setup()
    const jane = await screen.findByRole('region', { name: "Jane Doe's chores" })
    expect(within(jane).getByRole('heading', { name: 'Jane Doe' })).toBeInTheDocument()
    expect(within(jane).getByText('1 of 2 done')).toBeInTheDocument()
    const john = screen.getByRole('region', { name: "John Doe's chores" })
    expect(within(john).getByText('Due today')).toBeInTheDocument()
    const done = await screen.findByRole('listitem', { name: 'Tidy the shed' })
    expect(within(done).getByTestId('sticker-status')).toHaveTextContent('Available')
    expect(within(screen.getByRole('listitem', { name: 'Old job' })).getByRole('button', { name: 'Reopen Old job' })).toBeInTheDocument()
  })

  it('filters by the child query parameter', async () => {
    const api = mockApi({ active: [chore(), chore({ choreId: 11, childId: 2, name: 'Water plants' })] })
    setup('/parent/chores?child=2')
    await screen.findByRole('listitem', { name: 'Water plants' })
    expect(screen.queryByRole('listitem', { name: 'Wash the car' })).not.toBeInTheDocument()
    expect(api.calls.some((c) => c.url.includes('childId=2'))).toBe(true)
  })

  it('changes the filter from the select', async () => {
    mockApi({ active: [chore(), chore({ choreId: 11, childId: 2, name: 'Water plants' })] })
    const { user, router } = setup()
    await screen.findByRole('listitem', { name: 'Wash the car' })
    await user.selectOptions(screen.getByLabelText('Child'), 'John Doe')
    expect(router.state.location.search).toBe('?child=2')
    await waitFor(() => expect(screen.queryByRole('listitem', { name: 'Wash the car' })).not.toBeInTheDocument())
  })

  it('shows Finished automatically and disables Uncheck when the sticker is used', async () => {
    mockApi({ closed: [finished({ sticker: sticker({ status: 'USED', revocable: false, autoFinished: true }) })] })
    setup()
    const card = await screen.findByRole('listitem', { name: 'Tidy the shed' })
    expect(within(card).getByTestId('sticker-auto-finished')).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: /Sweep/ })).toBeDisabled()
    expect(within(card).getByText(/already spent on a prize/)).toBeInTheDocument()
  })
})

describe('Chores page actions', () => {
  it('checks a task, then I\'m Done! offers the pick and goes to the child pick screen', async () => {
    const api = mockApi({ active: [chore({ state: 'READY_TO_FINISH', doneCount: 2, tasks: [
      { taskId: 101, label: 'Soap', iconKey: 'broom', done: true },
      { taskId: 102, label: 'Rinse', iconKey: 'broom', done: true },
    ] })] })
    server.use(
      http.post('*/api/children/1/chores/10/finish', () =>
        HttpResponse.json({
          chore: null,
          pick: { stickerId: 77, childId: 1, chartDate: TODAY, routineName: 'Wash the car', status: 'UNCLAIMED', choices: [], claimed: null, autoAwarded: false },
          revoked: null,
        }),
      ),
    )
    const { user, router } = setup()
    const card = await screen.findByRole('listitem', { name: 'Wash the car' })
    await user.click(within(card).getByRole('button', { name: "I'm Done!" }))
    expect(await screen.findByText('Jane Doe earned a sticker for Wash the car!')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Let Jane Doe pick now' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/c/1/pick/77'))
    expect(api.calls.length).toBeGreaterThan(0)
  })

  it('says a Gold Star was added when the pick was auto-awarded', async () => {
    mockApi({ active: [chore({ state: 'READY_TO_FINISH', doneCount: 2 })] })
    server.use(
      http.post('*/api/children/1/chores/10/finish', () =>
        HttpResponse.json({
          chore: null,
          pick: { stickerId: 77, childId: 1, chartDate: TODAY, routineName: 'Wash the car', status: 'AVAILABLE', choices: [], claimed: null, autoAwarded: true },
          revoked: null,
        }),
      ),
    )
    const { user } = setup()
    await user.click(await screen.findByRole('button', { name: "I'm Done!" }))
    expect(await screen.findByText(/A Gold Star was added/)).toBeInTheDocument()
  })

  it('checks a task with the toggle call', async () => {
    mockApi({ active: [chore()] })
    let called = ''
    server.use(
      http.put('*/api/children/1/chores/10/tasks/102', ({ request }) => {
        called = new URL(request.url).pathname
        return HttpResponse.json({ chore: null, pick: null, revoked: null })
      }),
    )
    const { user } = setup()
    await user.click(await screen.findByRole('checkbox', { name: 'Rinse' }))
    await waitFor(() => expect(called).toBe('/api/children/1/chores/10/tasks/102'))
  })

  it('removes a chore after confirmation', async () => {
    const api = mockApi({ active: [chore()] })
    capture(api, 'delete', '*/api/parent/chores/10', () => new HttpResponse(null, { status: 204 }))
    const { user } = setup()
    await user.click(await screen.findByRole('button', { name: 'Remove Wash the car' }))
    expect(api.calls.some((c) => c.method === 'DELETE')).toBe(false)
    await user.click(await screen.findByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(api.calls.some((c) => c.method === 'DELETE' && c.url === '/api/parent/chores/10')).toBe(true))
    expect(await screen.findByText('Wash the car removed.')).toBeInTheDocument()
  })

  it('reopens a missed chore on No due date and sends dueDate null', async () => {
    const api = mockApi({ closed: [chore({ choreId: 30, name: 'Old job', state: 'MISSED', closedOn: '2029-12-25', dueDate: '2029-12-25' })] })
    capture(api, 'put', '*/api/parent/chores/30', () => HttpResponse.json(chore({ choreId: 30 })))
    const { user } = setup()
    await user.click(await screen.findByRole('button', { name: 'Reopen Old job' }))
    const dialog = await screen.findByRole('dialog', { name: 'Reopen chore' })
    expect(within(dialog).getByRole('button', { name: 'No due date' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.calls.find((c) => c.method === 'PUT')).toBeTruthy())
    expect((api.calls.find((c) => c.method === 'PUT')?.body as ChoreInput).dueDate).toBeNull()
    expect((api.calls.find((c) => c.method === 'PUT')?.body as ChoreInput).tasks.map((t) => t.id)).toEqual([101, 102])
  })

  it('Assign again prefills name, icon and tasks', async () => {
    const api = mockApi({ closed: [finished()] })
    capture(api, 'post', '*/api/parent/children/:childId/chores', () => HttpResponse.json(chore()))
    const { user } = setup()
    await user.click(await screen.findByRole('button', { name: 'Assign Tidy the shed again' }))
    const dialog = await screen.findByRole('dialog', { name: 'Assign a chore' })
    expect(within(dialog).getByLabelText('Chore name')).toHaveValue('Tidy the shed')
    expect(within(dialog).getByLabelText('Task 1')).toHaveValue('Sweep')
    expect(within(dialog).getByLabelText('Task 2')).toHaveValue('Stack')
    expect(within(dialog).getByRole('checkbox', { name: 'Jane Doe' })).toBeChecked()
    expect(within(dialog).getByRole('checkbox', { name: 'John Doe' })).not.toBeChecked()
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.calls.some((c) => c.method === 'POST')).toBe(true))
    const body = api.calls.find((c) => c.method === 'POST')?.body as ChoreInput
    expect(body.tasks).toEqual([
      { label: 'Sweep', iconKey: 'broom' },
      { label: 'Stack', iconKey: 'broom' },
    ])
  })
})

describe('revoke from the Chores page', () => {
  async function openRevoke(c: Chore) {
    const api = mockApi({ closed: [c] })
    const view = setup()
    const card = await screen.findByRole('listitem', { name: c.name })
    await view.user.click(within(card).getByRole('button', { name: /Sweep/ }))
    const sheet = await screen.findByRole('dialog', { name: 'Remove this sticker?' })
    return { api, sheet, ...view }
  }

  it('says the chore goes back on the chart, and sends the revoke call', async () => {
    let query = ''
    const { user, sheet } = await openRevoke(finished({ dueDate: null }))
    server.use(
      http.delete('*/api/children/1/chores/20/tasks/201', ({ request }) => {
        query = new URL(request.url).search
        return HttpResponse.json({ chore: null, pick: null, revoked: null })
      }),
    )
    expect(within(sheet).getByText("Tidy the shed will go back on Jane Doe's chart.")).toBeInTheDocument()
    await user.click(within(sheet).getByRole('button', { name: 'Remove sticker' }))
    await waitFor(() => expect(query).toBe('?revokeSticker=true'))
    expect(await screen.findByText('Sticker removed.')).toBeInTheDocument()
  })

  it('says Missed when the due date has passed', async () => {
    const { sheet } = await openRevoke(finished({ dueDate: '2029-12-30' }))
    expect(within(sheet).getByText('Its due date has passed, so it will show as Missed.')).toBeInTheDocument()
  })

  it('switches the outcome and sends removeChore when the checkbox is ticked', async () => {
    let query = ''
    const { user, sheet } = await openRevoke(finished())
    server.use(
      http.delete('*/api/children/1/chores/20/tasks/201', ({ request }) => {
        query = new URL(request.url).search
        return HttpResponse.json({ chore: null, pick: null, revoked: null })
      }),
    )
    const box = within(sheet).getByRole('checkbox', { name: 'Remove this chore too' })
    expect(box).not.toBeChecked()
    await user.click(box)
    expect(within(sheet).getByText('Tidy the shed will be removed.')).toBeInTheDocument()
    await user.click(within(sheet).getByRole('button', { name: 'Remove sticker' }))
    await waitFor(() => expect(query).toContain('removeChore=true'))
  })

  it('shows the blocked state on STICKER_USED', async () => {
    const { user, sheet } = await openRevoke(finished())
    server.use(http.delete('*/api/children/1/chores/20/tasks/201', () => problem(409, 'STICKER_USED')))
    await user.click(within(sheet).getByRole('button', { name: 'Remove sticker' }))
    expect(await within(sheet).findByRole('alert')).toHaveTextContent(/already spent on a prize/)
    expect(within(sheet).queryByRole('button', { name: 'Remove sticker' })).not.toBeInTheDocument()
  })
})

describe('chore form', () => {
  async function openForm(api: Api, path = '/parent/chores') {
    const view = setup(path)
    await view.user.click(await screen.findByRole('button', { name: 'Assign a chore' }))
    const dialog = await screen.findByRole('dialog', { name: 'Assign a chore' })
    return { ...view, dialog, api }
  }

  it('sends one task with the chore name and icon when the list is empty', async () => {
    const api = mockApi({}, [JANE])
    capture(api, 'post', '*/api/parent/children/:childId/chores', () => HttpResponse.json(chore()))
    const { user, dialog } = await openForm(api)
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument()
    await user.type(within(dialog).getByLabelText('Chore name'), 'Feed the cat')
    await user.click(within(dialog).getByRole('button', { name: 'Tomorrow' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.calls.some((c) => c.method === 'POST')).toBe(true))
    const post = api.calls.find((c) => c.method === 'POST')
    expect(post?.url).toBe('/api/parent/children/1/chores')
    expect(post?.body).toEqual({
      name: 'Feed the cat',
      iconKey: 'broom',
      dueDate: '2030-01-02',
      tasks: [{ label: 'Feed the cat', iconKey: 'broom' }],
    })
  })

  it('refuses a past due date', async () => {
    const api = mockApi({}, [JANE])
    const { user, dialog } = await openForm(api)
    await user.type(within(dialog).getByLabelText('Chore name'), 'Feed the cat')
    const date = within(dialog).getByLabelText('Or pick a later date')
    expect(date).toHaveAttribute('min', TODAY)
    await user.type(date, '2029-12-01')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByText('Pick today or a later date')).toBeInTheDocument()
    expect(api.calls.some((c) => c.method === 'POST')).toBe(false)
  })

  it('edits keeping task ids and sends the simple task id with the new name', async () => {
    const simple = chore({
      name: 'Feed the cat',
      tasks: [{ taskId: 555, label: 'Feed the cat', iconKey: 'broom', done: true }],
      taskCount: 1,
      doneCount: 1,
      dueDate: TODAY,
    })
    const api = mockApi({ active: [simple] })
    capture(api, 'put', '*/api/parent/chores/10', () => HttpResponse.json(simple))
    const { user } = setup()
    await user.click(await screen.findByRole('button', { name: 'Edit Feed the cat' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit chore' })
    expect(within(dialog).queryByLabelText('Task 1')).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('switch', { name: 'Done already' })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Today' })).toHaveAttribute('aria-pressed', 'true')
    const name = within(dialog).getByLabelText('Chore name')
    await user.clear(name)
    await user.type(name, 'Feed the dog')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.calls.some((c) => c.method === 'PUT')).toBe(true))
    expect(api.calls.find((c) => c.method === 'PUT')?.body).toEqual({
      name: 'Feed the dog',
      iconKey: 'broom',
      dueDate: TODAY,
      tasks: [{ id: 555, label: 'Feed the dog', iconKey: 'broom' }],
    })
  })

  it('edits a chore with several tasks and sends every loaded id back', async () => {
    const c = chore()
    const api = mockApi({ active: [c] })
    capture(api, 'put', '*/api/parent/chores/10', () => HttpResponse.json(c))
    const { user } = setup()
    await user.click(await screen.findByRole('button', { name: 'Edit Wash the car' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit chore' })
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.calls.some((c) => c.method === 'PUT')).toBe(true))
    const body = api.calls.find((x) => x.method === 'PUT')?.body as ChoreInput
    expect(body.tasks).toEqual([
      { id: 101, label: 'Soap', iconKey: 'broom' },
      { id: 102, label: 'Rinse', iconKey: 'broom' },
    ])
  })

  it('fills the form from a recent chip', async () => {
    const api = mockApi({ recent: [{ name: 'Water plants', iconKey: 'broom', tasks: [{ label: 'Fill can', iconKey: 'broom' }, { label: 'Pour', iconKey: 'broom' }] }] }, [JANE])
    const { user, dialog } = await openForm(api)
    await user.click(await within(dialog).findByRole('button', { name: 'Water plants' }))
    expect(within(dialog).getByLabelText('Chore name')).toHaveValue('Water plants')
    expect(within(dialog).getByLabelText('Task 1')).toHaveValue('Fill can')
    expect(within(dialog).getByLabelText('Task 2')).toHaveValue('Pour')
  })

  it('Done already hides the due date, sends alreadyDone and offers the pick', async () => {
    const api = mockApi({}, [JANE])
    capture(api, 'post', '*/api/parent/children/:childId/chores', () =>
      HttpResponse.json(chore({ state: 'AWAITING_PICK', sticker: sticker({ stickerId: 88, status: 'UNCLAIMED', design: null }) })),
    )
    const { user, dialog, router } = await openForm(api)
    await user.type(within(dialog).getByLabelText('Chore name'), 'Wash the car')
    await user.click(within(dialog).getByRole('switch', { name: 'Done already' }))
    expect(within(dialog).queryByRole('button', { name: 'Tomorrow' })).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.calls.some((c) => c.method === 'POST')).toBe(true))
    expect(api.calls.find((c) => c.method === 'POST')?.body).toMatchObject({ alreadyDone: true, dueDate: null })
    await user.click(await screen.findByRole('button', { name: 'Let Jane Doe pick now' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/c/1/pick/88'))
  })

  it('assigns to several children and unticks the ones that succeeded after a partial failure', async () => {
    const api = mockApi({}, [JANE, JOHN])
    server.use(
      http.post('*/api/parent/children/:childId/chores', async ({ request, params }) => {
        api.calls.push({ method: 'POST', url: `/${params.childId as string}`, body: await request.json() })
        return params.childId === '2' ? problem(409, 'CHORE_LIMIT_REACHED') : HttpResponse.json(chore())
      }),
    )
    const { user, dialog } = await openForm(api)
    await user.type(within(dialog).getByLabelText('Chore name'), 'Wash the car')
    await user.click(within(dialog).getByRole('checkbox', { name: 'Jane Doe' }))
    await user.click(within(dialog).getByRole('checkbox', { name: 'John Doe' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByText('John Doe already has 5 chores to do.')).toBeInTheDocument()
    expect(within(dialog).getByRole('checkbox', { name: 'Jane Doe' })).not.toBeChecked()
    expect(within(dialog).getByRole('checkbox', { name: 'John Doe' })).toBeChecked()
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.calls.filter((c) => c.method === 'POST')).toHaveLength(3))
    expect(api.calls.filter((c) => c.url === '/1')).toHaveLength(1)
  })

  it('opens with the filtered child ticked', async () => {
    const api = mockApi({}, [JANE, JOHN])
    const { dialog } = await openForm(api, '/parent/chores?child=2')
    expect(within(dialog).getByRole('checkbox', { name: 'John Doe' })).toBeChecked()
    expect(within(dialog).getByRole('checkbox', { name: 'Jane Doe' })).not.toBeChecked()
  })

  it('shows the limit message with one child', async () => {
    const api = mockApi({}, [JANE])
    server.use(http.post('*/api/parent/children/:childId/chores', () => problem(409, 'CHORE_LIMIT_REACHED')))
    const { user, dialog } = await openForm(api)
    await user.type(within(dialog).getByLabelText('Chore name'), 'Wash the car')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByText('Jane Doe already has 5 chores to do.')).toBeInTheDocument()
  })

  it('shows server field errors on the fields', async () => {
    const api = mockApi({}, [JANE])
    server.use(
      http.post('*/api/parent/children/:childId/chores', () =>
        problem(400, 'VALIDATION_FAILED', { fieldErrors: [{ field: 'name', message: 'Name is already used' }, { field: 'tasks[0].label', message: 'Bad task' }] }),
      ),
    )
    const { user, dialog } = await openForm(api)
    await user.type(within(dialog).getByLabelText('Chore name'), 'Wash the car')
    await user.click(within(dialog).getByRole('button', { name: 'Add task' }))
    await user.type(within(dialog).getByLabelText('Task 1'), 'Soap')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByText('Name is already used')).toBeInTheDocument()
    expect(within(dialog).getByText('Bad task')).toBeInTheDocument()
  })
})
