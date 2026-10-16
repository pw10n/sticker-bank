import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { DeviceSettingsContext } from './deviceSettingsContext'

const LAST_CHILD_KEY = 'sb.lastChildId'
const SOUNDS_KEY = 'sb.soundsOn'

/** In-memory fallback used when localStorage throws (private mode, blocked storage). */
const memory = new Map<string, string>()

function readItem(key: string): string | null {
  try {
    const v = localStorage.getItem(key)
    if (v !== null) return v
  } catch {
    /* fall through to memory */
  }
  return memory.get(key) ?? null
}

function writeItem(key: string, value: string | null) {
  if (value === null) memory.delete(key)
  else memory.set(key, value)
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* memory fallback already updated */
  }
}

function readLastChild(): number | null {
  const raw = readItem(LAST_CHILD_KEY)
  if (raw === null) return null
  const n = Number(raw)
  return Number.isInteger(n) ? n : null
}

function readSoundsOn(): boolean {
  return readItem(SOUNDS_KEY) !== 'false'
}



export function DeviceSettingsProvider({ children }: { children: ReactNode }) {
  const [lastChildId, setLast] = useState<number | null>(readLastChild)
  const [soundsOn, setSounds] = useState<boolean>(readSoundsOn)

  const setLastChildId = useCallback((id: number | null) => {
    writeItem(LAST_CHILD_KEY, id === null ? null : String(id))
    setLast(id)
  }, [])
  const setSoundsOn = useCallback((on: boolean) => {
    writeItem(SOUNDS_KEY, String(on))
    setSounds(on)
  }, [])

  const value = useMemo(
    () => ({ lastChildId, setLastChildId, soundsOn, setSoundsOn }),
    [lastChildId, setLastChildId, soundsOn, setSoundsOn],
  )
  return <DeviceSettingsContext.Provider value={value}>{children}</DeviceSettingsContext.Provider>
}
