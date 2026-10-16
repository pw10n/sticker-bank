import { useRef } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

export interface ServiceWorkerApi {
  needRefresh: boolean
  /** Ask the browser to check for a new service worker right now. */
  checkForUpdate(): void
  /** Activate the waiting worker and reload. */
  applyUpdate(): void
  /**
   * Last resort when no new worker arrives: drop the service workers and their caches, then reload from the network.
   * Automatic calls run at most once per 10 minutes, so a server asking for a build it does not serve cannot loop;
   * `force` is for a person pressing Reload.
   */
  hardReload(force?: boolean): void
}

const HARD_RELOAD_KEY = 'sb.hardReloadAt'
const HARD_RELOAD_MIN_GAP_MS = 10 * 60_000

async function wipeAndReload() {
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations()
      await Promise.all(registrations.map((r) => r.unregister()))
    }
    if (typeof caches !== 'undefined') await Promise.all((await caches.keys()).map((k) => caches.delete(k)))
  } catch {
    /* reload anyway: the network copy is what we want */
  }
  window.location.reload()
}

function hardReload(force = false): void {
  if (!force) {
    try {
      const last = Number(localStorage.getItem(HARD_RELOAD_KEY))
      if (last && Date.now() - last < HARD_RELOAD_MIN_GAP_MS) return
      localStorage.setItem(HARD_RELOAD_KEY, String(Date.now()))
    } catch {
      return // Without storage there is no loop guard, so do not reload on our own.
    }
  }
  void wipeAndReload()
}

/** Thin wrapper so tests can vi.mock it (jsdom has no service worker). */
export function useServiceWorker(): ServiceWorkerApi {
  const registration = useRef<ServiceWorkerRegistration | undefined>(undefined)
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      registration.current = reg
    },
  })
  return {
    needRefresh,
    checkForUpdate: () => {
      void registration.current?.update()
    },
    applyUpdate: () => {
      void updateServiceWorker(true)
    },
    hardReload,
  }
}
