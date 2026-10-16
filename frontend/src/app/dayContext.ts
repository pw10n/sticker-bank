import { createContext, useContext } from 'react'

export interface TodayInfo {
  today: string | null
  nextDayStartsAt: string | null
  serverOffsetMs: number
}

export const DayContext = createContext<TodayInfo>({ today: null, nextDayStartsAt: null, serverOffsetMs: 0 })

export function useToday(): TodayInfo {
  return useContext(DayContext)
}
