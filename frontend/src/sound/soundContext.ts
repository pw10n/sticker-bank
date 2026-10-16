import { createContext, useContext } from 'react'
import type { SoundName } from './synth'

export interface SoundApi {
  play(name: SoundName): void
}

export const SoundContext = createContext<SoundApi>({ play: () => {} })

export function useSound(): SoundApi {
  return useContext(SoundContext)
}
