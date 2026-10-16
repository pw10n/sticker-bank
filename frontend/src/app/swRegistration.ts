import { useRef } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

export interface ServiceWorkerApi {
  needRefresh: boolean
  /** Ask the browser to check for a new service worker right now. */
  checkForUpdate(): void
  /** Activate the waiting worker and reload. */
  applyUpdate(): void
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
  }
}
