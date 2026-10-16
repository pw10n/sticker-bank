import { createContext, useContext } from 'react'

export type Mode = 'child' | 'parent'

export interface ModeApi {
  mode: Mode
  enterParentMode(): void
  exitParentMode(): Promise<void>
}

export const ModeContext = createContext<ModeApi>({
  mode: 'child',
  enterParentMode: () => {},
  exitParentMode: () => Promise.resolve(),
})

export function useMode(): ModeApi {
  return useContext(ModeContext)
}
