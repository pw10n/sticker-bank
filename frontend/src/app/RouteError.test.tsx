import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RouteError from './RouteError'

function Boom({ message }: { message: string }): never {
  throw new Error(message)
}

function renderAt(path: string, message?: string) {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <div>home</div>,
        errorElement: <RouteError />,
      },
      {
        path: '/broken',
        element: <Boom message={message ?? 'secret stack detail'} />,
        errorElement: <RouteError />,
      },
      {
        path: '/loader',
        loader: () => {
          throw new Response('nope', { status: 404 })
        },
        element: <div>never</div>,
        errorElement: <RouteError />,
      },
    ],
    { initialEntries: [path] },
  )
  render(<RouterProvider router={router} />)
  return router
}

describe('RouteError', () => {
  afterEach(() => vi.restoreAllMocks())

  it('shows a friendly reload prompt for chunk load failures', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    renderAt('/broken', 'Failed to fetch dynamically imported module: /assets/x.js')
    expect(screen.getByText(/A new version may be ready/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go home' })).toHaveAttribute('href', '/')
    expect(screen.queryByText(/dynamically imported/)).not.toBeInTheDocument()
  })

  it('shows a generic message without leaking error details', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    renderAt('/broken')
    expect(screen.getByText('Oops! Something went wrong.')).toBeInTheDocument()
    expect(screen.queryByText(/secret stack detail/)).not.toBeInTheDocument()
  })

  it('shows a not-found message for 404 route errors', async () => {
    renderAt('/loader')
    expect(await screen.findByText("That page isn't here.")).toBeInTheDocument()
  })

  it('reloads on Try again and navigates home on Go home', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
    const router = renderAt('/broken')
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(reload).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('link', { name: 'Go home' }))
    expect(router.state.location.pathname).toBe('/')
    expect(await screen.findByText('home')).toBeInTheDocument()
    vi.unstubAllGlobals()
  })
})
