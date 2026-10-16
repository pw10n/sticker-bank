import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ChartRoutine,
  DailyChart,
  History,
  Revocation,
  StickerStatus,
  TaskToggleResult,
} from '../../api/types'
import { resetFakeApi, setFakeParentSession } from '../../mocks/fakeApi'
import { server } from '../../mocks/server'
import HistoryScreen from './HistoryScreen'
import { DayDetail } from './DayDetail'

vi.mock('../../ui/celebrate', async (orig) => {
  const actual = await orig<typeof import('../../ui/celebrate')>()
  return { ...actual, celebrateRoutine: vi.fn(() => Promise.resolve()), celebrateTask: vi.fn() }
})
import { celebrateRoutine } from '../../ui/celebrate'

const DATE = '2026-03-10'

function routine(status: StickerStatus | null, done = true): ChartRoutine {
  return {
    routineId: 7,
    name: 'Morning Routine',
    iconKey: 'sun',
    color: null,
    state: status ? (status === 'UNCLAIMED' ? 'AWAITING_PICK' : 'EARNED') : 'IN_PROGRESS',
    doneCount: done ? 2 : 1,
    taskCount: 2,
    sticker: status
      ? {
          stickerId: 99,
          status,
          design: status === 'UNCLAIMED' ? null : { designId: 5, name: 'Happy Frog', artworkKey: 'sticker-frog' },
          prizeRequestId: status === 'PENDING' ? 3 : null,
          revocable: status !== 'USED',
          autoFinished: false,
        }
      : null,
    tasks: [
      { taskId: 71, label: 'Brush teeth', iconKey: 'tooth', done: true },
      { taskId: 72, label: 'Get dressed', iconKey: 'shirt', done },
    ],
  }
}

function revocation(over: Partial<Revocation> = {}): Revocation {
  return {
    childId: 1,
    chartDate: DATE,
    routineId: 7,
    routineName: 'Morning Routine',
    routineIconKey: 'sun',
    taskId: 71,
    taskLabel: 'Brush teeth',
    stickerId: 99,
    fromStatus: 'AVAILABLE',
    design: { designId: 5, name: 'Happy Frog', artworkKey: 'sticker-frog' },
    prizeRequestId: null,
    requestCancelled: false,
    note: null,
    revokedAt: '2026-03-10T15:30:00Z',
    ...over,
  }
}

let chart: DailyChart
let posts: Request[]
let postCount: number

function install(opts: { chartRoutine: ChartRoutine; history?: History; deleteStatus?: number }) {
  chart = { childId: 1, date: DATE, isToday: false, routines: [opts.chartRoutine], unclaimedFromEarlierDays: [] }
  posts = []
  postCount = 0
  server.use(
    http.get('*/api/children/:childId/days/:date', () => HttpResponse.json(chart)),
    http.delete('*/api/children/:childId/days/:date/tasks/:taskId', ({ request }) => {
      posts.push(request.clone())
      postCount += 1
      if (opts.deleteStatus) {
        return HttpResponse.json({ title: 'Conflict', status: opts.deleteStatus, code: 'STICKER_USED' }, { status: opts.deleteStatus })
      }
      const after = routine(null, false)
      chart = { ...chart, routines: [after] }
      const result: TaskToggleResult = {
        routine: after,
        pick: null,
        revoked: { stickerId: 99, fromStatus: 'AVAILABLE', prizeRequestId: null, requestCancelled: false },
      }
      return HttpResponse.json(result)
    }),
  )
  if (opts.history) {
    server.use(http.get('*/api/parent/children/:childId/history', () => HttpResponse.json(opts.history)))
  }
}

function renderDay() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter(
    [{ path: '/', element: <DayDetail childId={1} childName="Jane Doe" date={DATE} onClose={() => {}} onChanged={() => {}} /> }],
    { initialEntries: ['/'] },
  )
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  resetFakeApi()
  setFakeParentSession(true)
  vi.mocked(celebrateRoutine).mockClear()
})

function prizeRequest(count: number) {
  return {
    id: 3,
    childId: 1,
    childName: 'Jane Doe',
    status: 'PENDING',
    createdBy: 'CHILD',
    createdAt: '2026-03-10T10:00:00Z',
    cancelReason: null,
    cancelledAt: null,
    cancelledBy: null,
    completedAt: null,
    reversedAt: null,
    note: null,
    prizeText: null,
    stickerCount: count,
    stickers: [],
  }
}

describe('sticker review', () => {
  it.each([
    ['UNCLAIMED', 'Unclaimed'],
    ['AVAILABLE', 'Available'],
    ['PENDING', 'Pending'],
    ['USED', 'Used'],
  ] as const)('labels a %s sticker with a text chip', async (status, label) => {
    install({ chartRoutine: routine(status) })
    renderDay()
    expect(await screen.findByTestId('sticker-status')).toHaveTextContent(label)
    if (status === 'UNCLAIMED') expect(screen.getByText('Not picked yet')).toBeInTheDocument()
    else expect(screen.getByText('Happy Frog')).toBeInTheDocument()
  })
})

describe('revoke flow', () => {
  it('confirms with a note, DELETEs with revokeSticker=true and the CSRF header, waits, shows a calm note and no celebration', async () => {
    install({ chartRoutine: routine('AVAILABLE') })
    const user = userEvent.setup()
    renderDay()
    await user.click(await screen.findByRole('button', { name: /Brush teeth/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Remove this sticker?' })
    expect(within(dialog).getByText('Happy Frog')).toBeInTheDocument()
    expect(dialog.textContent).toContain("Unchecking 'Brush teeth' in Morning Routine on")
    expect(dialog.textContent).not.toContain('prize request')
    await user.type(within(dialog).getByLabelText('Note (optional)'), 'Tapped by mistake')
    await user.click(within(dialog).getByRole('button', { name: 'Remove sticker' }))
    expect(await screen.findByText('Sticker removed.')).toBeInTheDocument()
    expect(posts).toHaveLength(1)
    expect(posts[0].headers.get('X-Sticker-Bank')).toBe('1')
    expect(new URL(posts[0].url).searchParams.get('revokeSticker')).toBe('true')
    expect(await posts[0].text()).toContain('Tapped by mistake')
    expect(await screen.findByText('1 of 2 done')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Remove this sticker?' })).toBeNull()
    expect(celebrateRoutine).not.toHaveBeenCalled()
  })

  it('is busy while waiting for the server', async () => {
    install({ chartRoutine: routine('AVAILABLE') })
    server.use(
      http.delete('*/api/children/:childId/days/:date/tasks/:taskId', async () => {
        await new Promise((r) => setTimeout(r, 150))
        return HttpResponse.json({ routine: routine(null, false), pick: null, revoked: null })
      }),
    )
    const user = userEvent.setup()
    renderDay()
    await user.click(await screen.findByRole('button', { name: /Brush teeth/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Remove this sticker?' })
    await user.click(within(dialog).getByRole('button', { name: /Remove sticker/ }))
    expect(within(dialog).getByRole('button', { name: /Remove sticker/ })).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByText('Sticker removed.')).toBeNull()
    expect(await screen.findByText('Sticker removed.')).toBeInTheDocument()
  })

  it('Cancel closes without sending', async () => {
    install({ chartRoutine: routine('AVAILABLE') })
    const user = userEvent.setup()
    renderDay()
    await user.click(await screen.findByRole('button', { name: /Brush teeth/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Remove this sticker?' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Remove this sticker?' })).toBeNull())
    expect(postCount).toBe(0)
  })

  it('describes an unpicked sticker', async () => {
    install({ chartRoutine: routine('UNCLAIMED') })
    const user = userEvent.setup()
    renderDay()
    await user.click(await screen.findByRole('button', { name: /Brush teeth/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Remove this sticker?' })
    expect(within(dialog).getByText('Not picked yet')).toBeInTheDocument()
  })

  it.each([
    [2, false],
    [1, true],
  ])('PENDING with %i stickers in the request: cancel warning is %s', async (count, cancels) => {
    install({ chartRoutine: routine('PENDING') })
    server.use(
      http.get('*/api/children/:childId/prize-requests/pending', () =>
        HttpResponse.json({ request: prizeRequest(count) }),
      ),
    )
    const user = userEvent.setup()
    renderDay()
    await user.click(await screen.findByRole('button', { name: /Brush teeth/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Remove this sticker?' })
    expect(dialog.textContent).toContain('This sticker is in a prize request. It will be taken out')
    await waitFor(() =>
      expect(dialog.textContent?.includes(', and the request will be cancelled')).toBe(cancels),
    )
  })

  it('disables the uncheck affordance for a used sticker and explains why', async () => {
    install({ chartRoutine: routine('USED') })
    renderDay()
    const btn = await screen.findByRole('button', { name: /Brush teeth/ })
    expect(btn).toBeDisabled()
    expect(screen.getByText("This sticker was already spent on a prize, so it can't be taken back.")).toBeInTheDocument()
    expect(postCount).toBe(0)
  })

  it('shows the explanation in the sheet when the server says STICKER_USED', async () => {
    install({ chartRoutine: routine('AVAILABLE'), deleteStatus: 409 })
    const user = userEvent.setup()
    renderDay()
    await user.click(await screen.findByRole('button', { name: /Brush teeth/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Remove this sticker?' })
    await user.click(within(dialog).getByRole('button', { name: 'Remove sticker' }))
    expect(await within(dialog).findByText(/already spent on a prize/)).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Remove sticker' })).toBeNull()
  })

  it('shows an inline retry message on other errors', async () => {
    install({ chartRoutine: routine('AVAILABLE') })
    server.use(
      http.delete('*/api/children/:childId/days/:date/tasks/:taskId', () =>
        HttpResponse.json({ title: 'Oops', status: 500 }, { status: 500 }),
      ),
    )
    const user = userEvent.setup()
    renderDay()
    await user.click(await screen.findByRole('button', { name: /Brush teeth/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Remove this sticker?' })
    await user.click(within(dialog).getByRole('button', { name: 'Remove sticker' }))
    expect(await within(dialog).findByText('Could not remove the sticker. Please try again.')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Remove sticker' })).toBeEnabled()
  })

  it('opens the sheet when a plain toggle returns REVOKE_CONFIRMATION_REQUIRED', async () => {
    install({ chartRoutine: { ...routine('AVAILABLE'), state: 'IN_PROGRESS' } })
    server.use(
      http.put('*/api/children/:childId/days/:date/tasks/:taskId', () =>
        HttpResponse.json(
          {
            title: 'Conflict',
            status: 409,
            code: 'REVOKE_CONFIRMATION_REQUIRED',
            sticker: routine('AVAILABLE').sticker,
          },
          { status: 409 },
        ),
      ),
      http.delete('*/api/children/:childId/days/:date/tasks/:taskId', () =>
        HttpResponse.json(
          {
            title: 'Conflict',
            status: 409,
            code: 'REVOKE_CONFIRMATION_REQUIRED',
            sticker: routine('AVAILABLE').sticker,
          },
          { status: 409 },
        ),
      ),
    )
    const user = userEvent.setup()
    renderDay()
    await user.click(await screen.findByRole('button', { name: /Brush teeth/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Remove this sticker?' })
    expect(within(dialog).getByText('Happy Frog')).toBeInTheDocument()
  })
})

describe('history log', () => {
  const history = (rev: Revocation[]): History => ({
    childId: 1,
    from: DATE,
    to: DATE,
    days: [{ date: DATE, routines: [], revocations: rev }],
  }) as unknown as History

  it('lists revocations in the day detail', async () => {
    install({
      chartRoutine: routine(null, false),
      history: history([revocation({ requestCancelled: true, note: 'Tapped by mistake' }), revocation({ stickerId: 100, design: null, taskLabel: 'Get dressed' })]),
    })
    renderDay()
    expect(await screen.findByText(/↩ Brush teeth unchecked, Happy Frog removed/)).toBeInTheDocument()
    expect(screen.getByText('Prize request cancelled')).toBeInTheDocument()
    expect(screen.getByText('Tapped by mistake')).toBeInTheDocument()
    expect(screen.getByText(/↩ Get dressed unchecked, unpicked sticker removed/)).toBeInTheDocument()
  })

  it('shows a removed marker in the week view', async () => {
    const today = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    const t = `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`
    server.use(
      http.get('*/api/parent/children/:childId/history', () =>
        HttpResponse.json({
          childId: 1,
          from: t,
          to: t,
          days: [{ date: t, routines: [], revocations: [revocation({ chartDate: t }), revocation({ stickerId: 100, chartDate: t })] }],
        }),
      ),
    )
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const router = createMemoryRouter([{ path: '/parent/history/:childId', element: <HistoryScreen /> }], {
      initialEntries: ['/parent/history/1'],
    })
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )
    const day = await screen.findByTestId(`day-${t}`)
    expect(await within(day).findByText('↩ 2 removed')).toBeInTheDocument()
  })
})
