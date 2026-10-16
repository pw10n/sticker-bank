import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useBootstrap } from '../api/hooks/bootstrap'
import { DayContext } from './dayContext'
import { useNotifySafeMoment } from './updateContext'



const MAX_TIMEOUT_MS = 2 ** 31 - 1

export function DayRolloverProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const notifySafeMoment = useNotifySafeMoment()
  const { data, dataUpdatedAt } = useBootstrap()

  const today = data?.today ?? null
  const nextDayStartsAt = data?.nextDayStartsAt ?? null
  const serverTime = data?.serverTime
  // dataUpdatedAt is when the response arrived, so this is the client/server clock offset.
  const serverOffsetMs = serverTime && dataUpdatedAt ? Date.parse(serverTime) - dataUpdatedAt : 0

  const notifyRef = useRef(notifySafeMoment)
  useEffect(() => {
    notifyRef.current = notifySafeMoment
  })

  // Rollover timer.
  useEffect(() => {
    if (!nextDayStartsAt) return
    const target = Date.parse(nextDayStartsAt) - serverOffsetMs + 1000
    const delay = Math.min(Math.max(target - Date.now(), 1000), MAX_TIMEOUT_MS)
    const id = setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
      void queryClient.invalidateQueries({ queryKey: ['chart'] })
      notifyRef.current()
    }, delay)
    return () => clearTimeout(id)
  }, [nextDayStartsAt, serverOffsetMs, queryClient])

  // Today changed: yesterday's charts are stale.
  const prevToday = useRef<string | null>(null)
  useEffect(() => {
    if (!today) return
    if (prevToday.current !== null && prevToday.current !== today) {
      void queryClient.invalidateQueries({ queryKey: ['chart'] })
      notifyRef.current()
    }
    prevToday.current = today
  }, [today, queryClient])

  // Coming back to the app: the day may have rolled over while it slept.
  useEffect(() => {
    const refetch = () => void queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refetch()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', refetch)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', refetch)
    }
  }, [queryClient])

  const value = useMemo(
    () => ({ today, nextDayStartsAt, serverOffsetMs }),
    [today, nextDayStartsAt, serverOffsetMs],
  )
  return <DayContext.Provider value={value}>{children}</DayContext.Provider>
}
