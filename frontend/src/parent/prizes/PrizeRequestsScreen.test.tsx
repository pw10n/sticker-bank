import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server'
import { getFakeState, resetFakeApi, setFakeParentSession, type ScenarioName } from '../../mocks/fakeApi'
import PrizeRequestsScreen from './PrizeRequestsScreen'

function setup(scenario: ScenarioName = 'default', url = '/parent/prizes') {
  resetFakeApi(scenario)
  setFakeParentSession(true)
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter([{ path: '/parent/prizes', element: <PrizeRequestsScreen /> }], {
    initialEntries: [url],
  })
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

describe('PrizeRequestsScreen', () => {
  it('shows a pending request with 2 stickers', async () => {
    setup('pending-request')
    expect(await screen.findByText('Jane Doe')).toBeInTheDocument()
    expect(screen.getByText('2 stickers')).toBeInTheDocument()
    expect(screen.getByText(/Started by/)).toBeInTheDocument()
  })

  it('shows empty state', async () => {
    setup()
    expect(await screen.findByText('No prize requests waiting')).toBeInTheDocument()
  })

  it('validates and completes a prize', async () => {
    const user = setup('pending-request')
    await user.click(await screen.findByRole('button', { name: 'Give prize' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Give prize' }))
    expect(await within(dialog).findByText('Please say what prize was given')).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText('What prize did you give?'), 'Ice cream')
    await user.click(within(dialog).getByRole('button', { name: 'Give prize' }))
    expect(await screen.findByText('Stickers marked as used')).toBeInTheDocument()
    expect(getFakeState().prizeRequests.some((r) => r.status === 'COMPLETED' && r.prizeText === 'Ice cream')).toBe(true)
    await user.click(screen.getByRole('tab', { name: 'History' }))
    expect(await screen.findByText('Ice cream')).toBeInTheDocument()
  })

  it('cancels a request and returns stickers', async () => {
    const user = setup('pending-request')
    await user.click(await screen.findByRole('button', { name: 'Cancel request' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Cancel this request\? The 2 stickers go back to Jane Doe\./)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel request' }))
    await waitFor(() => expect(getFakeState().prizeRequests.every((r) => r.status !== 'PENDING')).toBe(true))
    expect(getFakeState().stickers.filter((s) => s.prizeRequestId !== null && s.status === 'USED')).toHaveLength(3)
    expect(await screen.findByText('No prize requests waiting')).toBeInTheDocument()
  })

  it('shows history, filters and edits', async () => {
    const user = setup('default', '/parent/prizes?tab=history')
    expect(await screen.findByText('Trip to the playground')).toBeInTheDocument()
    expect(screen.getByText('Prize given')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Edit prize for/ }))
    const dialog = await screen.findByRole('dialog')
    const field = within(dialog).getByLabelText('What prize did you give?')
    await user.clear(field)
    await user.type(field, 'Zoo visit')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Zoo visit')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Child'), 'John Doe')
    await waitFor(() => expect(screen.queryByText('Zoo visit')).not.toBeInTheDocument())
  })

  it('starts a request for John', async () => {
    const user = setup()
    await user.click(await screen.findByRole('button', { name: 'Start a request' }))
    const dialog = await screen.findByRole('dialog')
    await user.selectOptions(within(dialog).getByLabelText('Which child?'), 'John Doe')
    const tiles = await within(dialog).findAllByRole('button', { pressed: false })
    const stickerTiles = tiles.filter((t) => t.hasAttribute('aria-pressed'))
    await user.click(stickerTiles[0])
    await user.click(stickerTiles[1])
    await user.click(within(dialog).getByRole('button', { name: 'Create request' }))
    expect(await screen.findByText('Started by a grown-up')).toBeInTheDocument()
    expect(screen.getByText('2 stickers')).toBeInTheDocument()
  })

  it('blocks starting for a child with a pending request', async () => {
    const user = setup('pending-request')
    await user.click(await screen.findByRole('button', { name: 'Start a request' }))
    const dialog = await screen.findByRole('dialog')
    await user.selectOptions(within(dialog).getByLabelText('Which child?'), 'Jane Doe')
    expect(await within(dialog).findByText(/already has a request waiting/)).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Create request' })).not.toBeInTheDocument()
  })

  it('shows cancelled-by-revocation history with struck-through revoked stickers', async () => {
    const design = (n: number) => ({ designId: n, name: `Design ${n}`, artworkKey: 'sticker-frog' })
    const base = {
      childId: 1,
      childName: 'Jane Doe',
      status: 'CANCELLED',
      createdBy: 'CHILD',
      createdAt: '2026-03-10T10:00:00Z',
      cancelledAt: '2026-03-10T11:00:00Z',
      cancelledBy: 'PARENT',
      completedAt: null,
      reversedAt: null,
      note: null,
      prizeText: null,
    }
    const sticker = (id: number, revoked: boolean) => ({
      stickerId: id,
      chartDate: '2026-03-10',
      routineName: 'Morning Routine',
      design: design(id),
      revoked,
    })
    server.use(
      http.get('*/api/parent/prize-requests', () =>
        HttpResponse.json({
          items: [
            { ...base, id: 11, cancelReason: 'ALL_STICKERS_REVOKED', stickerCount: 0, stickers: [sticker(21, true)] },
            { ...base, id: 12, cancelReason: 'CANCELLED', stickerCount: 1, stickers: [sticker(22, false)] },
          ],
          nextCursor: null,
        }),
      ),
    )
    const user = setup('default', '/parent/prizes?tab=history')
    expect(await screen.findByText('Cancelled: stickers removed')).toBeInTheDocument()
    expect(screen.getByText('Cancelled')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'History' }))
    const struck = screen.getByText('Design 21')
    expect(struck.tagName).toBe('S')
    expect(struck.parentElement?.textContent).toContain('(revoked)')
    expect(screen.queryByText('Design 22')).toBeNull()
  })
})
