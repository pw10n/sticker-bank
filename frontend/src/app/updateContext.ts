import { createContext, useContext, useMemo } from 'react'

export interface UpdateApi {
  updateWaiting: boolean
  applyUpdate(): void
  setCelebrating(active: boolean): void
  notifySafeMoment(): void
}

export const UpdateContext = createContext<UpdateApi>({
  updateWaiting: false,
  applyUpdate: () => {},
  setCelebrating: () => {},
  notifySafeMoment: () => {},
})

export function useUpdatePrompt(): { updateWaiting: boolean; applyUpdate(): void } {
  const { updateWaiting, applyUpdate } = useContext(UpdateContext)
  return { updateWaiting, applyUpdate }
}

export function useCelebrationGuard(): { setCelebrating(active: boolean): void } {
  const { setCelebrating } = useContext(UpdateContext)
  return useMemo(() => ({ setCelebrating }), [setCelebrating])
}

/** Internal: lets the day-rollover logic report a safe moment to apply a waiting update. */
export function useNotifySafeMoment(): () => void {
  return useContext(UpdateContext).notifySafeMoment
}
