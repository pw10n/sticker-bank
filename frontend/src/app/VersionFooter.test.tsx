import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bootstrapFixture, makeClient, mockBootstrap } from './testUtils'
import { VersionFooter } from './VersionFooter'

afterEach(() => vi.unstubAllEnvs())

function renderFooter() {
  render(
    <QueryClientProvider client={makeClient()}>
      <VersionFooter />
    </QueryClientProvider>,
  )
  return screen.getByTestId('version-footer')
}

describe('VersionFooter', () => {
  it('shows the app version at once and the server version once it is known', async () => {
    vi.stubEnv('VITE_APP_VERSION', '2026.1016.100000')
    mockBootstrap(() => bootstrapFixture({ appVersion: '2026.1016.153938' }))
    const footer = renderFooter()
    expect(footer).toHaveTextContent(/^App 2026\.1016\.100000$/)
    await waitFor(() => expect(footer).toHaveTextContent('App 2026.1016.100000 · Server 2026.1016.153938'))
  })

  it('makes a stale app visible: the two numbers differ', async () => {
    vi.stubEnv('VITE_APP_VERSION', '2026.1016.100000')
    mockBootstrap(() => bootstrapFixture({ appVersion: '2026.1017.090000' }))
    const footer = renderFooter()
    await waitFor(() => expect(footer.textContent).toContain('Server 2026.1017.090000'))
    expect(footer.textContent).toContain('App 2026.1016.100000')
  })

  it('calls an unstamped local build dev', async () => {
    mockBootstrap(() => bootstrapFixture({ appVersion: 'dev' }))
    const footer = renderFooter()
    await waitFor(() => expect(footer).toHaveTextContent('App dev · Server dev'))
  })
})
