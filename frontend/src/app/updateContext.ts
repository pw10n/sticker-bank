import { createContext, useContext, useMemo } from 'react'

export interface UpdateApi {
  updateWaiting: boolean
  /** The server says this build is too old to keep running (TDD 9.5). */
  updateRequired: boolean
  applyUpdate(): void
  setCelebrating(active: boolean): void
  notifySafeMoment(): void
}

export const UpdateContext = createContext<UpdateApi>({
  updateWaiting: false,
  updateRequired: false,
  applyUpdate: () => {},
  setCelebrating: () => {},
  notifySafeMoment: () => {},
})

export function useUpdatePrompt(): { updateWaiting: boolean; updateRequired: boolean; applyUpdate(): void } {
  const { updateWaiting, updateRequired, applyUpdate } = useContext(UpdateContext)
  return { updateWaiting, updateRequired, applyUpdate }
}

export function useCelebrationGuard(): { setCelebrating(active: boolean): void } {
  const { setCelebrating } = useContext(UpdateContext)
  return useMemo(() => ({ setCelebrating }), [setCelebrating])
}

/** Internal: lets the day-rollover logic report a safe moment to apply a waiting update. */
export function useNotifySafeMoment(): () => void {
  return useContext(UpdateContext).notifySafeMoment
}
