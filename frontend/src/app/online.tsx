import { onlineManager, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { isApiError } from '../api/errors'
import { OnlineContext, useOnlineStatus } from './onlineContext'


export function OnlineStatusProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine !== false,
  )

  useEffect(() => {
    const goOnline = () => setOnline(true)
    const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    const unsubManager = onlineManager.subscribe((isOnline) => setOnline(isOnline))

    const handle = (action: { type: string; error?: unknown } | undefined) => {
      if (!action) return
      if (action.type === 'error' && isApiError(action.error, 'NETWORK')) setOnline(false)
      else if (action.type === 'success') setOnline(true)
    }
    const unsubQueries = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === 'updated') handle(event.action as { type: string; error?: unknown })
    })
    const unsubMutations = queryClient.getMutationCache().subscribe((event) => {
      if (event.type === 'updated') handle(event.action as { type: string; error?: unknown })
    })
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
      unsubManager()
      unsubQueries()
      unsubMutations()
    }
  }, [queryClient])

  const value = useMemo(() => ({ online }), [online])
  return <OnlineContext.Provider value={value}>{children}</OnlineContext.Provider>
}



export function OfflineBanner() {
  const { online } = useOnlineStatus()
  if (online) return null
  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-2 bg-paper px-4 py-2 text-center font-semibold text-ink shadow"
    >
      <span aria-hidden="true">☁️</span>
      <span>Waiting for Wi-Fi…</span>
    </div>
  )
}
