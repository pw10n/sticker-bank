import { act, render, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeviceSettingsProvider } from './deviceSettings'
import { useDeviceSettings } from './deviceSettingsContext'

function fakeStorage(throws = false) {
  const m = new Map<string, string>()
  return {
    m,
    getItem: (k: string) => {
      if (throws) throw new Error('blocked')
      return m.get(k) ?? null
    },
    setItem: (k: string, v: string) => {
      if (throws) throw new Error('blocked')
      m.set(k, v)
    },
    removeItem: (k: string) => {
      if (throws) throw new Error('blocked')
      m.delete(k)
    },
  }
}

const wrapper = ({ children }: { children: ReactNode }) => <DeviceSettingsProvider>{children}</DeviceSettingsProvider>

afterEach(() => vi.unstubAllGlobals())

describe('announced chores (no provider)', () => {
  it('is an empty list and a no-op', () => {
    const { result } = renderHook(() => useDeviceSettings())
    expect(result.current.announcedChoreIds(1)).toEqual([])
    expect(() => result.current.markChoresAnnounced(1, [1], [1])).not.toThrow()
    render(<div />)
  })
})

describe('announced chores', () => {
  let storage: ReturnType<typeof fakeStorage>
  beforeEach(() => {
    storage = fakeStorage()
    vi.stubGlobal('localStorage', storage)
  })

  it('stores ids per child under sb.announcedChores', () => {
    const { result } = renderHook(() => useDeviceSettings(), { wrapper })
    act(() => result.current.markChoresAnnounced(1, [10, 11], [10, 11, 12]))
    act(() => result.current.markChoresAnnounced(1, [12], [10, 11, 12]))
    act(() => result.current.markChoresAnnounced(2, [20], [20]))
    expect(result.current.announcedChoreIds(1)).toEqual([10, 11, 12])
    expect(result.current.announcedChoreIds(2)).toEqual([20])
    expect(JSON.parse(storage.m.get('sb.announcedChores') ?? '{}')).toEqual({ '1': [10, 11, 12], '2': [20] })
  })

  it('returns the same array instance when nothing is stored', () => {
    const { result } = renderHook(() => useDeviceSettings(), { wrapper })
    expect(result.current.announcedChoreIds(5)).toBe(result.current.announcedChoreIds(5))
    expect(result.current.announcedChoreIds(5)).toBe(result.current.announcedChoreIds(6))
  })

  it('drops stored ids that are not on the chart', () => {
    const { result } = renderHook(() => useDeviceSettings(), { wrapper })
    act(() => result.current.markChoresAnnounced(1, [10, 11], [10, 11]))
    act(() => result.current.markChoresAnnounced(1, [12], [11, 12]))
    expect(result.current.announcedChoreIds(1)).toEqual([11, 12])
  })

  it('reads the stored value on mount and tolerates garbage', () => {
    storage.m.set('sb.announcedChores', JSON.stringify({ '1': [5] }))
    const first = renderHook(() => useDeviceSettings(), { wrapper })
    expect(first.result.current.announcedChoreIds(1)).toEqual([5])
    storage.m.set('sb.announcedChores', 'not json')
    const second = renderHook(() => useDeviceSettings(), { wrapper })
    expect(second.result.current.announcedChoreIds(1)).toEqual([])
  })

  it('falls back to memory when storage throws', () => {
    vi.stubGlobal('localStorage', fakeStorage(true))
    const { result } = renderHook(() => useDeviceSettings(), { wrapper })
    act(() => result.current.markChoresAnnounced(3, [7], [7]))
    expect(result.current.announcedChoreIds(3)).toEqual([7])
  })
})
