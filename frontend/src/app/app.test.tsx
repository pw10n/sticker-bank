import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/errors'
import { qk } from '../api/queryKeys'
import { server } from '../mocks/server'
import { SoundProvider, useSound } from '../sound'
import { useToday } from './dayContext'
import { DayRolloverProvider } from './dayRollover'
import { DeviceSettingsProvider } from './deviceSettings'
import { useDeviceSettings } from './deviceSettingsContext'
import { useParentIdleTimer } from './idleTimer'
import { ModeProvider } from './mode'
import { useMode } from './modeContext'
import { OfflineBanner, OnlineStatusProvider } from './online'
import { shouldDehydrateQuery } from './persister'
import { createQueryClient } from './queryClient'
import { bootstrapFixture, makeClient, mockBootstrap, wrapperFor } from './testUtils'
import { useCelebrationGuard, useUpdatePrompt } from './updateContext'
import { UpdatePromptProvider, UpdateToast } from './updatePrompt'

const swState = { needRefresh: false, apply: vi.fn(), check: vi.fn() }
vi.mock('./swRegistration', () => ({
  useServiceWorker: () => ({
    needRefresh: swState.needRefresh,
    applyUpdate: swState.apply,
    checkForUpdate: swState.check,
  }),
}))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
  swState.needRefresh = false
  swState.apply.mockClear()
  swState.check.mockClear()
})

describe('queryClient defaults', () => {
  it('does not retry 4xx, makes mutations network-always', () => {
    const d = createQueryClient().getDefaultOptions()
    const retry = d.queries!.retry as (c: number, e: unknown) => boolean
    expect(retry(0, new ApiError(404, 'UNKNOWN'))).toBe(false)
    expect(retry(0, new ApiError(500, 'UNKNOWN'))).toBe(true)
    expect(retry(3, new ApiError(500, 'UNKNOWN'))).toBe(false)
    expect(d.mutations!.networkMode).toBe('always')
    expect(d.mutations!.retry).toBe(false)
  })
})

describe('persister filter', () => {
  const q = (key: unknown[], status: string) =>
    ({ queryKey: key, state: { status } }) as unknown as Parameters<typeof shouldDehydrateQuery>[0]
  it('persists only successful bootstrap/chart/book', () => {
    expect(shouldDehydrateQuery(q(['bootstrap'], 'success'))).toBe(true)
    expect(shouldDehydrateQuery(q(['chart', 1, 'x'], 'success'))).toBe(true)
    expect(shouldDehydrateQuery(q(['book', 1, 'ALL'], 'success'))).toBe(true)
    expect(shouldDehydrateQuery(q(['bootstrap'], 'error'))).toBe(false)
    expect(shouldDehydrateQuery(q(['parent', 'settings'], 'success'))).toBe(false)
    expect(shouldDehydrateQuery(q(['pick', 1], 'success'))).toBe(false)
  })
})

function stubStorage() {
  const m = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  })
}

describe('deviceSettings', () => {
  it('falls back to memory when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    const { result } = renderHook(() => useDeviceSettings(), { wrapper: DeviceSettingsProvider })
    expect(result.current.soundsOn).toBe(true)
    expect(result.current.lastChildId).toBeNull()
    act(() => {
      result.current.setSoundsOn(false)
      result.current.setLastChildId(7)
    })
    expect(result.current.soundsOn).toBe(false)
    expect(result.current.lastChildId).toBe(7)
    act(() => result.current.setSoundsOn(true))
  })

  it('persists to localStorage', () => {
    stubStorage()
    const { result } = renderHook(() => useDeviceSettings(), { wrapper: DeviceSettingsProvider })
    act(() => result.current.setLastChildId(3))
    expect(localStorage.getItem('sb.lastChildId')).toBe('3')
  })
})

describe('mode', () => {
  it('exit calls DELETE, removes parent queries and toggles body class', async () => {
    let deleted = false
    server.use(
      http.delete('*/api/parent/session', () => {
        deleted = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const client = makeClient()
    client.setQueryData(qk.parent.settings(), { x: 1 })
    client.setQueryData(qk.bootstrap(), { y: 1 })
    const { result } = renderHook(() => useMode(), {
      wrapper: wrapperFor(client, (c) => <ModeProvider>{c}</ModeProvider>),
    })
    expect(result.current.mode).toBe('child')
    expect(document.body.classList.contains('child-mode')).toBe(true)
    act(() => result.current.enterParentMode())
    expect(result.current.mode).toBe('parent')
    expect(document.body.classList.contains('child-mode')).toBe(false)
    await act(() => result.current.exitParentMode())
    expect(deleted).toBe(true)
    expect(client.getQueryData(qk.parent.settings())).toBeUndefined()
    expect(client.getQueryData(qk.bootstrap())).toBeDefined()
    expect(result.current.mode).toBe('child')
    expect(document.body.classList.contains('child-mode')).toBe(true)
  })
})

describe('idle timer', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  function setup(idle: number) {
    const touches = { n: 0 }
    server.use(
      http.get('*/api/bootstrap', () => HttpResponse.json(bootstrapFixture({ parentIdleTimeoutSeconds: idle }))),
      http.delete('*/api/parent/session', () => new HttpResponse(null, { status: 204 })),
      http.post('*/api/parent/session/touch', () => {
        touches.n++
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const onIdle = vi.fn()
    const client = makeClient()
    const hook = renderHook(
      () => {
        useParentIdleTimer({ onIdle })
        return useMode()
      },
      { wrapper: wrapperFor(client, (c) => <ModeProvider>{c}</ModeProvider>) },
    )
    return { onIdle, touches, hook }
  }

  it('fires onIdle after timeout, resets on activity, touches at most once a minute', async () => {
    const { onIdle, touches, hook } = setup(120)
    await waitFor(() => expect(hook.result.current.mode).toBe('child'))
    await vi.waitFor(() => expect(hook.result.current).toBeTruthy())
    act(() => hook.result.current.enterParentMode())
    // let bootstrap load so the timeout is 120s
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100_000)
    })
    act(() => {
      window.dispatchEvent(new Event('pointerdown'))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100_000)
    })
    expect(onIdle).not.toHaveBeenCalled()
    expect(touches.n).toBe(1)
    act(() => {
      window.dispatchEvent(new Event('keydown'))
      window.dispatchEvent(new Event('touchstart'))
    })
    expect(touches.n).toBe(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(121_000)
    })
    expect(onIdle).toHaveBeenCalledTimes(1)
    expect(hook.result.current.mode).toBe('child')
  })
})

describe('day rollover', () => {
  it('invalidates chart queries at nextDayStartsAt', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const now = Date.now()
    mockBootstrap(() =>
      bootstrapFixture({
        today: '2030-01-01',
        serverTime: new Date().toISOString(),
        nextDayStartsAt: new Date(now + 60_000).toISOString(),
      }),
    )
    const client = makeClient()
    client.setQueryData(['chart', 1, '2030-01-01'], { a: 1 })
    const { result } = renderHook(() => useToday(), {
      wrapper: wrapperFor(client, (c) => (
        <UpdatePromptProvider>
          <DayRolloverProvider>{c}</DayRolloverProvider>
        </UpdatePromptProvider>
      )),
    })
    await waitFor(() => expect(result.current.today).toBe('2030-01-01'))
    expect(client.getQueryState(['chart', 1, '2030-01-01'])?.isInvalidated).toBe(false)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(62_000)
    })
    expect(client.getQueryState(['chart', 1, '2030-01-01'])?.isInvalidated).toBe(true)
  })

  it('invalidates charts when today changes', async () => {
    let today = '2030-01-01'
    mockBootstrap(() =>
      bootstrapFixture({ today, serverTime: new Date().toISOString(), nextDayStartsAt: '2999-01-01T00:00:00Z' }),
    )
    const client = makeClient()
    client.setQueryData(['chart', 1, 'x'], { a: 1 })
    const { result } = renderHook(() => useToday(), {
      wrapper: wrapperFor(client, (c) => (
        <UpdatePromptProvider>
          <DayRolloverProvider>{c}</DayRolloverProvider>
        </UpdatePromptProvider>
      )),
    })
    await waitFor(() => expect(result.current.today).toBe('2030-01-01'))
    expect(client.getQueryState(['chart', 1, 'x'])?.isInvalidated).toBe(false)
    today = '2030-01-02'
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    await waitFor(() => expect(result.current.today).toBe('2030-01-02'))
    await waitFor(() => expect(client.getQueryState(['chart', 1, 'x'])?.isInvalidated).toBe(true))
  })
})

describe('offline banner', () => {
  function renderBanner(client = makeClient()) {
    render(
      <ProviderShell client={client}>
        <OfflineBanner />
      </ProviderShell>,
    )
    return client
  }
  function ProviderShell({ client, children }: { client: ReturnType<typeof makeClient>; children: ReactNode }) {
    const W = wrapperFor(client, (c) => <OnlineStatusProvider>{c}</OnlineStatusProvider>)
    return <W>{children}</W>
  }

  it('shows on offline event, hides on online event', () => {
    renderBanner()
    expect(screen.queryByRole('status')).toBeNull()
    act(() => {
      window.dispatchEvent(new Event('offline'))
    })
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for Wi-Fi')
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('shows on NETWORK query error and hides on success', async () => {
    const client = renderBanner()
    await act(async () => {
      await client
        .fetchQuery({
          queryKey: ['x'],
          queryFn: () => Promise.reject(new ApiError(0, 'NETWORK')),
          retry: false,
        })
        .catch(() => {})
    })
    expect(screen.getByRole('status')).toBeInTheDocument()
    await act(async () => {
      await client.fetchQuery({ queryKey: ['y'], queryFn: () => Promise.resolve(1) })
    })
    expect(screen.queryByRole('status')).toBeNull()
  })
})

describe('sound', () => {
  it('play does not throw in jsdom and is a no-op when off', () => {
    stubStorage()
    const { result } = renderHook(() => useSound(), {
      wrapper: ({ children }) => (
        <DeviceSettingsProvider>
          <SoundProvider>{children}</SoundProvider>
        </DeviceSettingsProvider>
      ),
    })
    expect(() => result.current.play('pop')).not.toThrow()
    localStorage.setItem('sb.soundsOn', 'false')
    expect(() => result.current.play('fanfare')).not.toThrow()
  })

  it('synthesizes with a fake AudioContext only when sounds are on', () => {
    const start = vi.fn()
    class FakeCtx {
      currentTime = 0
      state = 'running'
      destination = {}
      createOscillator() {
        const o = { type: '', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (x: unknown) => x, start, stop() {} }
        return o
      }
      createGain() {
        return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (x: unknown) => x }
      }
      resume() {
        return Promise.resolve()
      }
    }
    vi.stubGlobal('AudioContext', FakeCtx)
    const wrapper = ({ children }: { children: ReactNode }) => (
      <DeviceSettingsProvider>
        <SoundProvider>{children}</SoundProvider>
      </DeviceSettingsProvider>
    )
    const { result } = renderHook(() => ({ s: useSound(), d: useDeviceSettings() }), { wrapper })
    act(() => result.current.s.play('fanfare'))
    expect(start).toHaveBeenCalledTimes(4)
    act(() => result.current.d.setSoundsOn(false))
    act(() => result.current.s.play('pop'))
    expect(start).toHaveBeenCalledTimes(4)
    vi.unstubAllGlobals()
  })
})

describe('update prompt', () => {
  function setup() {
    mockBootstrap(() => bootstrapFixture())
    const client = makeClient()
    return renderHook(
      () => ({ mode: useMode(), up: useUpdatePrompt(), guard: useCelebrationGuard() }),
      {
        wrapper: wrapperFor(client, (c) => (
          <ModeProvider>
            <UpdatePromptProvider>
              <UpdateToast />
              {c}
            </UpdatePromptProvider>
          </ModeProvider>
        )),
      },
    )
  }
  const foreground = () => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  }

  it('applies a waiting update only at a safe moment in child mode', () => {
    swState.needRefresh = true
    const { result } = setup()
    expect(result.current.up.updateWaiting).toBe(true)
    expect(swState.apply).not.toHaveBeenCalled()
    act(foreground)
    expect(swState.apply).toHaveBeenCalledTimes(1)
  })

  it('never applies while celebrating', () => {
    swState.needRefresh = true
    const { result } = setup()
    act(() => result.current.guard.setCelebrating(true))
    act(foreground)
    expect(swState.apply).not.toHaveBeenCalled()
    act(() => result.current.guard.setCelebrating(false))
    act(foreground)
    expect(swState.apply).toHaveBeenCalledTimes(1)
  })

  it('shows the toast in parent mode instead of auto applying', () => {
    swState.needRefresh = true
    const { result } = setup()
    expect(screen.queryByText(/new version/)).toBeNull()
    act(() => result.current.mode.enterParentMode())
    act(foreground)
    expect(swState.apply).not.toHaveBeenCalled()
    act(() => screen.getByRole('button', { name: 'Reload' }).click())
    expect(swState.apply).toHaveBeenCalledTimes(1)
  })
})
