import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { getFakeState, resetFakeApi, setFakeParentSession } from '../../mocks/fakeApi'
import ChildEditScreen from './ChildEditScreen'
import ChildrenScreen from './ChildrenScreen'

function setup(path: string) {
  const router = createMemoryRouter(
    [
      { path: '/parent/children', element: <ChildrenScreen /> },
      { path: '/parent/children/:childId', element: <ChildEditScreen /> },
      { path: '/parent/children/:childId/routines', element: <div>routines stub</div> },
      { path: '/parent/history/:childId', element: <div>history stub</div> },
      { path: '/parent', element: <div>home stub</div> },
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

beforeEach(() => {
  resetFakeApi()
  setFakeParentSession(true)
})

describe('ChildrenScreen', () => {
  it('lists children with actions', async () => {
    setup('/parent/children')
    expect(await screen.findByText('Jane Doe')).toBeInTheDocument()
    expect(screen.getByText('John Doe')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Edit Jane Doe' })).toHaveAttribute('href', '/parent/children/1')
    expect(screen.getByRole('link', { name: 'Routines for Jane Doe' })).toHaveAttribute('href', '/parent/children/1/routines')
    expect(screen.getByRole('link', { name: 'History for Jane Doe' })).toHaveAttribute('href', '/parent/history/1')
  })

  it('shows an empty state', async () => {
    resetFakeApi('fresh-install')
    setFakeParentSession(true)
    setup('/parent/children')
    expect(await screen.findByText('No children yet')).toBeInTheDocument()
  })
})

describe('ChildEditScreen', () => {
  it('blocks a blank name', async () => {
    const user = userEvent.setup()
    setup('/parent/children/new')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Enter a name')).toBeInTheDocument()
    expect(screen.getByText('Pick a picture')).toBeInTheDocument()
    expect(getFakeState().children).toHaveLength(2)
  })

  it('creates a child then goes to their routines', async () => {
    const user = userEvent.setup()
    const router = setup('/parent/children/new')
    await user.type(screen.getByLabelText('Name'), '  Sam Sample ')
    const avatars = within(screen.getByRole('group', { name: 'Picture' }))
    await user.click(avatars.getAllByRole('button')[0])
    await user.click(screen.getByRole('button', { name: 'mint' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/parent\/children\/\d+\/routines$/))
    const created = getFakeState().children.find((c) => c.name === 'Sam Sample')
    expect(created?.themeColor).toBe('#56CFA1')
    expect(created?.avatarKey).toBeTruthy()
  })

  it('edits a child', async () => {
    const user = userEvent.setup()
    const router = setup('/parent/children/1')
    const name = await screen.findByLabelText('Name')
    expect(name).toHaveValue('Jane Doe')
    await user.clear(name)
    await user.type(name, 'Jane Q Doe')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/parent/children'))
    expect(getFakeState().children.find((c) => c.id === 1)?.name).toBe('Jane Q Doe')
  })

  it('deletes a child after confirming', async () => {
    const user = userEvent.setup()
    const router = setup('/parent/children/2')
    await user.click(await screen.findByRole('button', { name: 'Delete child' }))
    expect(
      screen.getByText(
        "Delete John Doe? This removes John Doe's routines, stickers, history and prize requests. This can't be undone.",
      ),
    ).toBeInTheDocument()
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/parent/children'))
    expect(getFakeState().children.map((c) => c.id)).toEqual([1])
  })
})
