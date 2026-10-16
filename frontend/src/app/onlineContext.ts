import { createContext, useContext } from 'react'

export const OnlineContext = createContext<{ online: boolean }>({ online: true })

export function useOnlineStatus(): { online: boolean } {
  return useContext(OnlineContext)
}

/** Screens grey out and disable taps when this is false (TDD 9.6). */
export function useCanWrite(): boolean {
  return useOnlineStatus().online
}
