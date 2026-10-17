import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react'
import { useBootstrap } from '../api/hooks/bootstrap'
import { getMinFrontendVersion, subscribeMinFrontendVersion } from '../api/minFrontendVersion'
import { buildVersion, isFrontendOutdated } from './frontendVersion'
import { useMode } from './modeContext'
import { useServiceWorker } from './swRegistration'
import { UpdateContext, useUpdatePrompt, type UpdateApi } from './updateContext'

/** While the build is too old, how often to look for a safe moment (and for the new worker). */
const ENFORCE_EVERY_MS = 5_000
/** How many of those ticks may ask the browser for a new service worker. */
const MAX_UPDATE_CHECKS = 6
/** If no new worker is waiting after this long, fall back to wiping the caches and reloading. */
const WORKER_WAIT_MS = 30_000
/** Applying a waiting worker reloads the page. If it is still here this long after, nothing controlled it: hard reload. */
const APPLY_GRACE_MS = 10_000

export function UpdatePromptProvider({ children }: { children: ReactNode }) {
  const { mode } = useMode()
  const sw = useServiceWorker()
  const queryClient = useQueryClient()
  const appVersion = useBootstrap().data?.appVersion
  const minVersion = useSyncExternalStore(subscribeMinFrontendVersion, getMinFrontendVersion)
  const outdated = isFrontendOutdated(buildVersion(), minVersion)

  const celebrating = useRef(false)
  const state = useRef({ mode, needRefresh: sw.needRefresh, apply: sw.applyUpdate, hardReload: sw.hardReload })
  useEffect(() => {
    state.current = { mode, needRefresh: sw.needRefresh, apply: sw.applyUpdate, hardReload: sw.hardReload }
  })

  const checkRef = useRef(sw.checkForUpdate)
  useEffect(() => {
    checkRef.current = sw.checkForUpdate
  })

  // Server is on a newer build than this bundle: look for the new service worker immediately (TDD 9.5).
  useEffect(() => {
    if (appVersion && appVersion !== 'dev' && buildVersion() !== 'dev' && appVersion !== buildVersion()) {
      checkRef.current()
    }
  }, [appVersion])

  // The server says this build is too old to keep running. Waiting for the app to be backgrounded is not enough: a tablet
  // left on the chart may never be, and meanwhile it talks to a newer server with old rules. So look for the new worker
  // now and apply it at the first safe moment: Child Mode, no celebration, no write in flight. If no worker shows up, or
  // applying it does not reload the page (a page no worker controls, such as after a hard refresh, never gets the
  // "controlling" event), wipe the caches and reload (at most once per 10 minutes). Parent Mode never reloads on its own
  // (see UpdateToast).
  useEffect(() => {
    if (!outdated) return
    let giveUpAt = Date.now() + WORKER_WAIT_MS
    let applied = false
    let checks = 0
    const enforce = () => {
      const s = state.current
      if (!s.needRefresh && checks++ < MAX_UPDATE_CHECKS) checkRef.current() // the first call may beat the registration
      if (s.mode !== 'child' || celebrating.current || queryClient.isMutating() > 0) return
      if (s.needRefresh && !applied) {
        applied = true
        giveUpAt = Date.now() + APPLY_GRACE_MS
        s.apply()
      } else if (Date.now() >= giveUpAt) {
        s.hardReload()
      }
    }
    enforce()
    const id = setInterval(enforce, ENFORCE_EVERY_MS)
    return () => clearInterval(id)
  }, [outdated, queryClient])

  const api = useMemo<UpdateApi>(() => {
    const notifySafeMoment = () => {
      const s = state.current
      if (s.mode === 'child' && s.needRefresh && !celebrating.current) s.apply()
    }
    return {
      updateWaiting: false,
      updateRequired: false,
      applyUpdate: () => {
        const s = state.current
        if (s.needRefresh) s.apply()
        else s.hardReload(true) // Required but no worker waiting: a person pressed Reload, so skip the loop guard.
      },
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

  const value = useMemo(
    () => ({ ...api, updateWaiting: sw.needRefresh, updateRequired: outdated }),
    [api, sw.needRefresh, outdated],
  )
  return <UpdateContext.Provider value={value}>{children}</UpdateContext.Provider>
}

export function UpdateToast() {
  const { mode } = useMode()
  const { updateWaiting, updateRequired, applyUpdate } = useUpdatePrompt()
  if (mode !== 'parent' || !(updateWaiting || updateRequired)) return null
  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-[calc(5.75rem+env(safe-area-inset-bottom))] z-50 md:bottom-4 mx-auto flex w-fit items-center gap-3 rounded-full bg-ink px-5 py-3 text-paper shadow-lg"
    >
      <span>{updateRequired ? 'This app is out of date and must reload' : 'A new version is ready'}</span>
      <button type="button" onClick={applyUpdate} className="rounded-full bg-paper px-4 py-1 font-semibold text-ink">
        Reload
      </button>
    </div>
  )
}
