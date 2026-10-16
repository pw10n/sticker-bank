import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server'
import { getFakeState, resetFakeApi, setFakeParentSession, type ScenarioName } from '../../mocks/fakeApi'
import LibraryScreen from './LibraryScreen'

function setup(scenario: ScenarioName = 'default') {
  resetFakeApi(scenario)
  setFakeParentSession(true)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter([{ path: '/parent/library', element: <LibraryScreen /> }], {
    initialEntries: ['/parent/library'],
  })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

const T = { timeout: 3000 }

async function waitForGrid() {
  await screen.findByRole('heading', { name: 'Rocket', level: 3 }, T)
}

function stickerCount() {
  return screen.getAllByRole('list', { name: 'Stickers' })[0].querySelectorAll(':scope > li').length
}

async function addSticker(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('button', { name: 'Add sticker' }))
  const dialog = await screen.findByRole('dialog')
  await user.type(within(dialog).getByLabelText('Name'), name)
  const group = within(dialog).getByRole('group', { name: 'Choose a picture' })
  await user.click(within(group).getAllByRole('button')[0])
  await user.click(within(dialog).getByRole('button', { name: 'Add sticker' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument(), T)
}

describe('LibraryScreen', () => {
  it('shows all 24 stickers and the explainer', async () => {
    setup()
    await waitForGrid()
    expect(stickerCount()).toBe(24)
    expect(screen.getByText(/One library for all children/)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('searches by name', async () => {
    const user = setup()
    await waitForGrid()
    await user.type(screen.getByLabelText('Search stickers'), 'rock')
    await waitFor(() => expect(stickerCount()).toBe(1), T)
    expect(screen.getByRole('heading', { name: 'Rocket', level: 3 })).toBeInTheDocument()
  })

  it('filters by status', async () => {
    const user = setup()
    await waitForGrid()
    await user.selectOptions(screen.getByLabelText('Status'), 'RETIRED')
    await waitFor(() => expect(screen.getByText('No stickers found')).toBeInTheDocument(), T)
    await user.selectOptions(screen.getByLabelText('Status'), 'ACTIVE')
    await waitFor(() => expect(stickerCount()).toBe(24), T)
  })

  it('adds a sticker', async () => {
    const user = setup()
    await waitForGrid()
    await addSticker(user, 'Test Sticker')
    expect(await screen.findByRole('heading', { name: 'Test Sticker' }, T)).toBeInTheDocument()
    expect(getFakeState().designs.some((d) => d.name === 'Test Sticker')).toBe(true)
  })

  it('edits a sticker name', async () => {
    const user = setup()
    await waitForGrid()
    await user.click(screen.getByRole('button', { name: 'Edit Rocket' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Changes show up everywhere/)).toBeInTheDocument()
    const input = within(dialog).getByLabelText('Name')
    await user.clear(input)
    await user.type(input, 'Super Rocket')
    await user.click(within(dialog).getByRole('button', { name: 'Save sticker' }))
    expect(await screen.findByRole('heading', { name: 'Super Rocket' }, T)).toBeInTheDocument()
  })

  it('retires and reactivates a sticker', async () => {
    const user = setup()
    await waitForGrid()
    await user.click(screen.getByRole('button', { name: 'Retire Rocket' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/never offered in a Sticker Pick/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Retire' }))
    const card = () => screen.getByRole('heading', { name: 'Rocket' }).closest('li') as HTMLElement
    await waitFor(() => expect(within(card()).getByText(/Retired/)).toBeInTheDocument(), T)
    await user.click(screen.getByRole('button', { name: 'Make Rocket active' }))
    await waitFor(() => expect(within(card()).getByText(/Active/)).toBeInTheDocument(), T)
  })

  it('warns when no stickers can be offered', async () => {
    setup('empty-library')
    const alert = await screen.findByRole('alert', {}, T)
    expect(alert).toHaveTextContent(/Gold Star will be given automatically/)
  })

  it('offers no delete for in-use stickers and suggests retiring', async () => {
    setup()
    await waitForGrid()
    const msg = screen.getAllByText('A child has earned this sticker — retire it instead')[0]
    const card = msg.closest('li') as HTMLElement
    expect(within(card).queryByRole('button', { name: /^Delete/ })).not.toBeInTheDocument()
    expect(within(card).getByRole('button', { name: /^Retire/ })).toBeInTheDocument()
  })

  it('deletes an unused sticker', async () => {
    const user = setup()
    await waitForGrid()
    await addSticker(user, 'Temp Sticker')
    await user.click(await screen.findByRole('button', { name: 'Delete Temp Sticker' }, T))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Temp Sticker' })).not.toBeInTheDocument(), T)
    expect(getFakeState().designs.some((d) => d.name === 'Temp Sticker')).toBe(false)
  })

  it('turns a pack off', async () => {
    const user = setup()
    await waitForGrid()
    const sw = await screen.findByRole('switch', { name: 'Animals pack on' }, T)
    await user.click(sw)
    await screen.findByRole('switch', { name: 'Animals pack off' }, T)
    expect(getFakeState().categories.find((c) => c.name === 'Animals')?.enabled).toBe(false)
  })

  it('adds a pack', async () => {
    const user = setup()
    await waitForGrid()
    await user.click(await screen.findByRole('button', { name: 'Add pack' }, T))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Pack name'), 'Dinosaurs')
    await user.click(within(dialog).getByRole('button', { name: 'Add pack' }))
    expect(await screen.findByRole('heading', { name: 'Dinosaurs' }, T)).toBeInTheDocument()
    expect(getFakeState().categories.some((c) => c.name === 'Dinosaurs')).toBe(true)
  })

  it('shows a server error for a duplicate pack name', async () => {
    const user = setup()
    server.use(
      http.post('*/api/parent/library/categories', () =>
        HttpResponse.json(
          { status: 400, code: 'VALIDATION_FAILED', fieldErrors: [{ field: 'name', message: 'That pack name is taken' }] },
          { status: 400, headers: { 'Content-Type': 'application/problem+json' } },
        ),
      ),
    )
    await waitForGrid()
    await user.click(await screen.findByRole('button', { name: 'Add pack' }, T))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Pack name'), 'Animals')
    await user.click(within(dialog).getByRole('button', { name: 'Add pack' }))
    expect(await within(dialog).findByText('That pack name is taken', {}, T)).toBeInTheDocument()
  })
})
