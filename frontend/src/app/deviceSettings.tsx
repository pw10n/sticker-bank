import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { DeviceSettingsContext } from './deviceSettingsContext'

const LAST_CHILD_KEY = 'sb.lastChildId'
const SOUNDS_KEY = 'sb.soundsOn'
const ANNOUNCED_KEY = 'sb.announcedChores'

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

function readAnnounced(): Record<string, number[]> {
  const raw = readItem(ANNOUNCED_KEY)
  if (raw === null) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    const out: Record<string, number[]> = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (Array.isArray(v)) out[k] = v.filter((n): n is number => Number.isInteger(n))
    }
    return out
  } catch {
    return {}
  }
}

/** One shared value for "nothing stored", so callers that depend on the list do not see a new array every render. */
const NO_IDS: number[] = []

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

  const [announced, setAnnounced] = useState<Record<string, number[]>>(readAnnounced)
  const announcedChoreIds = useCallback((childId: number) => announced[String(childId)] ?? NO_IDS, [announced])
  const markChoresAnnounced = useCallback((childId: number, ids: number[], onChart: number[]) => {
    const current = readAnnounced()
    const key = String(childId)
    const keep = new Set(onChart)
    const next = [...new Set([...(current[key] ?? []), ...ids])].filter((id) => keep.has(id))
    const updated = { ...current }
    if (next.length > 0) updated[key] = next
    else delete updated[key]
    writeItem(ANNOUNCED_KEY, JSON.stringify(updated))
    setAnnounced(updated)
  }, [])

  const value = useMemo(
    () => ({ lastChildId, setLastChildId, soundsOn, setSoundsOn, announcedChoreIds, markChoresAnnounced }),
    [lastChildId, setLastChildId, soundsOn, setSoundsOn, announcedChoreIds, markChoresAnnounced],
  )
  return <DeviceSettingsContext.Provider value={value}>{children}</DeviceSettingsContext.Provider>
}
