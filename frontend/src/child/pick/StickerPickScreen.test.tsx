import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server'
import { getFakeState, resetFakeApi } from '../../mocks/fakeApi'
import StickerPickScreen from './StickerPickScreen'

function setup(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter(
    [
      { path: '/c/:childId/pick/:stickerId', element: <StickerPickScreen /> },
      { path: '/c/:childId', element: <div>chart stub</div> },
      { path: '/c/:childId/book', element: <div>book stub</div> },
    ],
    { initialEntries: [path] },
  )
  const ui = () => (
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  const view = render(ui())
  return { router, client, view, ui }
}

function waitingSticker() {
  resetFakeApi('pick-waiting')
  const s = getFakeState().stickers.find((x) => x.childId === 1 && x.status === 'UNCLAIMED')
  if (!s) throw new Error('no sticker')
  return s
}

describe('StickerPickScreen', () => {
  it('shows choices, claims one, and shows the success view; reload shows claimed state', async () => {
    const s = waitingSticker()
    const user = userEvent.setup()
    const { client, view, ui } = setup(`/c/1/pick/${s.id}`)
    expect(await screen.findByText('Pick your sticker!')).toBeInTheDocument()
    const buttons = screen.getAllByRole('button').filter((b) => b.textContent !== 'Not now')
    expect(buttons).toHaveLength(3)
    buttons.forEach((b) => expect(b.textContent?.length).toBeGreaterThan(0))
    await user.click(buttons[0])
    expect(await screen.findByText("It's in your Sticker Book!", undefined, { timeout: 4000 })).toBeInTheDocument()
    expect(getFakeState().stickers.find((x) => x.id === s.id)?.status).toBe('AVAILABLE')
    expect(screen.getByRole('button', { name: 'See my Sticker Book' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back to my chart' })).toBeInTheDocument()
    view.unmount()
    client.clear()
    // re-render (reload)
    render(ui())
    expect(await screen.findByText(/^You got a /)).toBeInTheDocument()
  })

  it('Not now goes back without claiming', async () => {
    const s = waitingSticker()
    const user = userEvent.setup()
    const { router } = setup(`/c/1/pick/${s.id}`)
    await user.click(await screen.findByRole('button', { name: 'Not now' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/c/1'))
    expect(getFakeState().stickers.find((x) => x.id === s.id)?.status).toBe('UNCLAIMED')
  })

  it('shows the Gold Star message when auto-awarded', async () => {
    const s = waitingSticker()
    const mutable = s as unknown as { status: string; autoAwarded: boolean; designId: number; choices: number[] }
    mutable.status = 'AVAILABLE'
    mutable.autoAwarded = true
    mutable.designId = 25
    mutable.choices = []
    setup(`/c/1/pick/${s.id}`)
    expect(await screen.findByText("Here's a Gold Star for finishing!")).toBeInTheDocument()
  })

  it('redirects to the chart when the sticker belongs to another child', async () => {
    const s = waitingSticker()
    const { router } = setup(`/c/2/pick/${s.id}`)
    await waitFor(() => expect(router.state.location.pathname).toBe('/c/2'))
  })

  it('goes quietly back to the chart when the sticker was taken back (404)', async () => {
    const s = waitingSticker()
    server.use(
      http.get('*/api/stickers/:id/pick', () =>
        HttpResponse.json({ title: 'Not found', status: 404, code: 'NOT_FOUND' }, { status: 404 }),
      ),
    )
    const { router } = setup(`/c/1/pick/${s.id}`)
    await waitFor(() => expect(router.state.location.pathname).toBe('/c/1'))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('goes back to the chart when claiming returns 404', async () => {
    const s = waitingSticker()
    server.use(
      http.post('*/api/stickers/:id/pick', () =>
        HttpResponse.json({ title: 'Not found', status: 404, code: 'NOT_FOUND' }, { status: 404 }),
      ),
    )
    const user = userEvent.setup()
    const { router } = setup(`/c/1/pick/${s.id}`)
    await screen.findByText('Pick your sticker!')
    const buttons = screen.getAllByRole('button').filter((b) => b.textContent !== 'Not now')
    await user.click(buttons[0])
    await waitFor(() => expect(router.state.location.pathname).toBe('/c/1'))
  })

  it('closes quietly when claiming returns STICKER_REVOKED', async () => {
    const s = waitingSticker()
    server.use(
      http.post('*/api/stickers/:id/pick', () =>
        HttpResponse.json({ title: 'Conflict', status: 409, code: 'STICKER_REVOKED' }, { status: 409 }),
      ),
    )
    const user = userEvent.setup()
    const { router } = setup(`/c/1/pick/${s.id}`)
    await screen.findByText('Pick your sticker!')
    const buttons = screen.getAllByRole('button').filter((b) => b.textContent !== 'Not now')
    await user.click(buttons[0])
    await waitFor(() => expect(router.state.location.pathname).toBe('/c/1'))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('closes quietly when the pick has status REVOKED', async () => {
    const s = waitingSticker()
    server.use(
      http.get('*/api/stickers/:id/pick', () =>
        HttpResponse.json({
          stickerId: s.id,
          childId: 1,
          status: 'REVOKED',
          routineName: 'Morning Routine',
          choices: [],
          claimed: null,
          autoAwarded: false,
        }),
      ),
    )
    const { router } = setup(`/c/1/pick/${s.id}`)
    await waitFor(() => expect(router.state.location.pathname).toBe('/c/1'))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
