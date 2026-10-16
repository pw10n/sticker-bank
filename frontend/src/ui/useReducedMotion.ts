import { useSyncExternalStore } from 'react'
import { prefersReducedMotion } from './celebrate'

const QUERY = '(prefers-reduced-motion: reduce)'

function subscribe(cb: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  let mql: MediaQueryList
  try {
    mql = window.matchMedia(QUERY)
  } catch {
    return () => {}
  }
  if (typeof mql.addEventListener !== 'function') return () => {}
  mql.addEventListener('change', cb)
  return () => mql.removeEventListener('change', cb)
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, prefersReducedMotion, () => false)
}
