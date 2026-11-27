import { createContext, useContext } from 'react'

export interface DeviceSettings {
  lastChildId: number | null
  setLastChildId(id: number | null): void
  soundsOn: boolean
  setSoundsOn(on: boolean): void
  /** Chore ids whose arrival was already announced to this child on this device. */
  announcedChoreIds(childId: number): number[]
  /** Adds `ids` to the child's announced set and drops every stored id that is not in `onChart`. */
  markChoresAnnounced(childId: number, ids: number[], onChart: number[]): void
}

export const DeviceSettingsContext = createContext<DeviceSettings>({
  lastChildId: null,
  setLastChildId: () => {},
  soundsOn: true,
  setSoundsOn: () => {},
  announcedChoreIds: () => [],
  markChoresAnnounced: () => {},
})

export function useDeviceSettings(): DeviceSettings {
  return useContext(DeviceSettingsContext)
}
