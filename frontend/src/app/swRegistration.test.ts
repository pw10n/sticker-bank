import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The real module: app.test.tsx mocks it, but the hard reload and its loop guard must be tested for real.
vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false], updateServiceWorker: vi.fn() }),
}))

import { renderHook } from '@testing-library/react'
import { useServiceWorker } from './swRegistration'

const KEY = 'sb.hardReloadAt'

describe('hardReload', () => {
  const reload = vi.fn()
  const unregister = vi.fn(() => Promise.resolve(true))
  const deleteCache = vi.fn(() => Promise.resolve(true))
  const flush = () => new Promise((r) => setTimeout(r, 0))

  beforeEach(() => {
    const m = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
    })
    reload.mockClear()
    unregister.mockClear()
    deleteCache.mockClear()
    vi.stubGlobal('location', { ...window.location, reload })
    vi.stubGlobal('caches', { keys: () => Promise.resolve(['workbox-precache-v2']), delete: deleteCache })
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { getRegistrations: () => Promise.resolve([{ unregister }]) },
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const hardReload = () => renderHook(() => useServiceWorker()).result.current.hardReload

  it('drops the service workers and caches, then reloads from the network', async () => {
    hardReload()()
    await flush()
    expect(unregister).toHaveBeenCalledTimes(1)
    expect(deleteCache).toHaveBeenCalledWith('workbox-precache-v2')
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('does not repeat on its own within 10 minutes, so a bad minimum cannot cause a reload loop', async () => {
    const fn = hardReload()
    fn()
    await flush()
    fn()
    fn()
    await flush()
    expect(reload).toHaveBeenCalledTimes(1)

    localStorage.setItem(KEY, String(Date.now() - 11 * 60_000))
    fn()
    await flush()
    expect(reload).toHaveBeenCalledTimes(2)
  })

  it('a person pressing Reload skips the guard', async () => {
    const fn = hardReload()
    fn()
    await flush()
    fn(true)
    await flush()
    expect(reload).toHaveBeenCalledTimes(2)
  })

  it('does nothing on its own when storage is unavailable, since the guard cannot work', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    })
    hardReload()()
    await flush()
    expect(reload).not.toHaveBeenCalled()
  })

  it('still reloads if clearing the caches fails', async () => {
    vi.stubGlobal('caches', { keys: () => Promise.reject(new Error('nope')), delete: deleteCache })
    hardReload()()
    await flush()
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
