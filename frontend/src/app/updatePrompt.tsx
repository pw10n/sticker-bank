import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useBootstrap } from '../api/hooks/bootstrap'
import { useMode } from './modeContext'
import { useServiceWorker } from './swRegistration'
import { UpdateContext, useUpdatePrompt, type UpdateApi } from './updateContext'



const buildVersion: string = import.meta.env.VITE_APP_VERSION ?? 'dev'

export function UpdatePromptProvider({ children }: { children: ReactNode }) {
  const { mode } = useMode()
  const sw = useServiceWorker()
  const appVersion = useBootstrap().data?.appVersion

  const celebrating = useRef(false)
  const state = useRef({ mode, needRefresh: sw.needRefresh, apply: sw.applyUpdate })
  useEffect(() => {
    state.current = { mode, needRefresh: sw.needRefresh, apply: sw.applyUpdate }
  })

  const checkRef = useRef(sw.checkForUpdate)
  useEffect(() => {
    checkRef.current = sw.checkForUpdate
  })

  // Server is on a newer build than this bundle: look for the new service worker immediately (TDD 9.5).
  useEffect(() => {
    if (appVersion && appVersion !== 'dev' && buildVersion !== 'dev' && appVersion !== buildVersion) {
      checkRef.current()
    }
  }, [appVersion])

  const api = useMemo<UpdateApi>(() => {
    const notifySafeMoment = () => {
      const s = state.current
      if (s.mode === 'child' && s.needRefresh && !celebrating.current) s.apply()
    }
    return {
      updateWaiting: false,
      applyUpdate: () => state.current.apply(),
      setCelebrating: (active: boolean) => {
        celebrating.current = active
      },
      notifySafeMoment,
    }
  }, [])

  // App returns to the foreground: safe moment.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') api.notifySafeMoment()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [api])

  const value = useMemo(() => ({ ...api, updateWaiting: sw.needRefresh }), [api, sw.needRefresh])
  return <UpdateContext.Provider value={value}>{children}</UpdateContext.Provider>
}

export function UpdateToast() {
  const { mode } = useMode()
  const { updateWaiting, applyUpdate } = useUpdatePrompt()
  if (mode !== 'parent' || !updateWaiting) return null
  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-4 z-50 mx-auto flex w-fit items-center gap-3 rounded-full bg-ink px-5 py-3 text-paper shadow-lg"
    >
      <span>A new version is ready</span>
      <button type="button" onClick={applyUpdate} className="rounded-full bg-paper px-4 py-1 font-semibold text-ink">
        Reload
      </button>
    </div>
  )
}
