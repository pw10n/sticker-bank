import { createContext, useContext } from 'react'

export interface DeviceSettings {
  lastChildId: number | null
  setLastChildId(id: number | null): void
  soundsOn: boolean
  setSoundsOn(on: boolean): void
}

export const DeviceSettingsContext = createContext<DeviceSettings>({
  lastChildId: null,
  setLastChildId: () => {},
  soundsOn: true,
  setSoundsOn: () => {},
})

export function useDeviceSettings(): DeviceSettings {
  return useContext(DeviceSettingsContext)
}
