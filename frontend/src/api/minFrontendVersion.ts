/** Response header on every /api call: the oldest frontend build the server will keep serving (TDD 9.5). */
export const MIN_FRONTEND_VERSION_HEADER = 'X-Min-Frontend-Version'

let current: string | null = null
const listeners = new Set<() => void>()

/** The latest minimum the server announced, or null before the first response (or against a server that sends none). */
export function getMinFrontendVersion(): string | null {
  return current
}

export function subscribeMinFrontendVersion(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function reportMinFrontendVersion(version: string): void {
  if (version === current) return
  current = version
  listeners.forEach((l) => l())
}

/** Test helper: forget what the server announced. */
export function resetMinFrontendVersion(): void {
  current = null
  listeners.forEach((l) => l())
}
