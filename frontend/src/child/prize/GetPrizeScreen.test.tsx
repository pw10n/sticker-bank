import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { resetFakeApi } from '../../mocks/fakeApi'
import { server } from '../../mocks/server'
import GetPrizeScreen from './GetPrizeScreen'

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter(
    [
      { path: '/c/:childId/prize', element: <GetPrizeScreen /> },
      { path: '/c/:childId', element: <div>chart</div> },
    ],
    { initialEntries: ['/c/1/prize'] },
  )
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

const tiles = () => screen.findAllByRole('button', { pressed: false })

describe('GetPrizeScreen', () => {
  it('toggles selection and updates counter; submit disabled at 0', async () => {
    const user = userEvent.setup()
    setup()
    const all = await tiles()
    const submit = screen.getByRole('button', { name: 'Get my prize!' })
    expect(submit).toBeDisabled()
    await user.click(all[0])
    await user.click(all[1])
    expect(all[0]).toHaveAttribute('aria-pressed', 'true')
    expect(within(screen.getByTestId('prize-counter')).getByText('2')).toBeInTheDocument()
    expect(submit).toBeEnabled()
    await user.click(all[0])
    expect(all[0]).toHaveAttribute('aria-pressed', 'false')
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(submit).toBeDisabled()
  })

  it('submits and shows the waiting view', async () => {
    const user = userEvent.setup()
    setup()
    const all = await tiles()
    await user.click(all[0])
    await user.click(screen.getByRole('button', { name: 'Get my prize!' }))
    expect(await screen.findByText('Waiting for a grown-up')).toBeInTheDocument()
    expect(screen.getByText('Show a grown-up to get your prize!')).toBeInTheDocument()
  })

  it('shows pending request and cancel returns to selection', async () => {
    resetFakeApi('pending-request')
    const user = userEvent.setup()
    setup()
    expect(await screen.findByText('Waiting for a grown-up')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Put my stickers back' }))
    await user.click(await screen.findByRole('button', { name: 'Yes, put them back' }))
    expect(await screen.findByRole('button', { name: 'Get my prize!' })).toBeInTheDocument()
    expect((await tiles()).length).toBeGreaterThanOrEqual(2)
  })

  it('shows the empty state', async () => {
    server.use(
      http.get('*/api/children/:childId/stickers', () =>
        HttpResponse.json({
          counts: { available: 0, pending: 0, used: 0, totalEarned: 0, unclaimed: 0 },
          items: [],
          nextCursor: null,
        }),
      ),
    )
    setup()
    expect(await screen.findByText('Finish a routine to earn stickers!')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /chart/i })).toHaveAttribute('href', '/c/1')
  })

  it('handles STICKER_NOT_AVAILABLE', async () => {
    server.use(
      http.post('*/api/children/:childId/prize-requests', () =>
        HttpResponse.json(
          { code: 'STICKER_NOT_AVAILABLE', status: 409, title: 'Sticker not available' },
          { status: 409, headers: { 'Content-Type': 'application/problem+json' } },
        ),
      ),
    )
    const user = userEvent.setup()
    setup()
    const all = await tiles()
    await user.click(all[0])
    await user.click(screen.getByRole('button', { name: 'Get my prize!' }))
    expect(await screen.findByText('Some stickers changed — please pick again')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Get my prize!' })).toBeDisabled())
  })

  it('waiting view ignores revoked stickers', async () => {
    const st = (id: number, name: string, revoked: boolean) => ({
      stickerId: id,
      chartDate: '2026-03-10',
      routineName: 'Morning Routine',
      design: { designId: id, name, artworkKey: 'sticker-frog' },
      revoked,
    })
    server.use(
      http.get('*/api/children/:childId/prize-requests/pending', () =>
        HttpResponse.json({
          request: {
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
            stickerCount: 1,
            stickers: [st(1, 'Kept Frog', false), st(2, 'Gone Duck', true)],
          },
        }),
      ),
    )
    setup()
    expect(await screen.findByText('Waiting for a grown-up')).toBeInTheDocument()
    expect(screen.getByText('1 sticker')).toBeInTheDocument()
    const list = screen.getByRole('list', { name: 'Your stickers' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    expect(screen.queryByLabelText('Gone Duck')).toBeNull()
  })
})
