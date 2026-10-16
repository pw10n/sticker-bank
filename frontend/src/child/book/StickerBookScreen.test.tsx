import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it } from 'vitest'
import { getFakeState, resetFakeApi } from '../../mocks/fakeApi'
import StickerBookScreen from './StickerBookScreen'

function setup(childId = 1) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter(
    [
      { path: '/c/:childId/book', element: <StickerBookScreen /> },
      { path: '/c/:childId', element: <div>chart stub</div> },
    ],
    { initialEntries: [`/c/${childId}/book`] },
  )
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

const num = (id: string) => Number(within(screen.getByTestId(id)).getAllByText(/^\d+$/)[0].textContent)

describe('StickerBookScreen', () => {
  it('shows counters matching the fake and date headings', async () => {
    resetFakeApi('default')
    setup()
    await screen.findAllByTestId('book-sticker')
    const mine = getFakeState().stickers.filter((s) => s.childId === 1)
    await waitFor(() => expect(num('count-available')).toBe(mine.filter((s) => s.status === 'AVAILABLE').length))
    expect(num('count-used')).toBe(mine.filter((s) => s.status === 'USED').length)
    expect(num('count-pending')).toBe(mine.filter((s) => s.status === 'PENDING').length)
    expect(num('count-total')).toBe(mine.filter((s) => s.status !== 'UNCLAIMED').length)
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(headings.some((h) => h === 'Today' || h === 'Yesterday')).toBe(true)
  })

  it('marks USED faded and filters to Ready to spend', async () => {
    resetFakeApi('default')
    const user = userEvent.setup()
    setup()
    await screen.findAllByTestId('book-sticker')
    expect(screen.getAllByTestId('used-mark').length).toBe(3)
    await user.click(screen.getByRole('button', { name: 'Ready to spend' }))
    await waitFor(() => {
      const tiles = screen.getAllByTestId('book-sticker')
      expect(tiles.every((t) => t.getAttribute('data-status') === 'AVAILABLE')).toBe(true)
    })
  })

  it('shows the prize when tapping a USED sticker', async () => {
    resetFakeApi('default')
    const user = userEvent.setup()
    setup()
    const tiles = await screen.findAllByTestId('book-sticker')
    await user.click(tiles.find((t) => t.getAttribute('data-status') === 'USED') as HTMLElement)
    expect(await screen.findByText(/Trip to the playground/)).toBeInTheDocument()
  })

  it('shows an hourglass for PENDING stickers', async () => {
    resetFakeApi('pending-request')
    setup()
    await screen.findAllByTestId('book-sticker')
    expect(screen.getAllByTestId('pending-mark')).toHaveLength(2)
  })

  it('shows the unclaimed callout for John', async () => {
    resetFakeApi('default')
    setup(2)
    const callout = await screen.findByTestId('unclaimed-callout')
    expect(callout).toHaveTextContent('1 sticker to pick!')
    expect(callout).toHaveAttribute('href', '/c/2')
  })
})
