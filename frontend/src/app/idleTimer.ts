import { useEffect, useRef } from 'react'
import { api } from '../api/client'
import { useBootstrap } from '../api/hooks/bootstrap'
import { useMode } from './modeContext'

const TOUCH_INTERVAL_MS = 60_000
const DEFAULT_IDLE_SECONDS = 300

/** Locks parent mode after inactivity (FR-8.4) and keeps the server session alive (TDD 7.8). */
export function useParentIdleTimer(opts: { onIdle: () => void }): void {
  const { mode, exitParentMode } = useMode()
  const idleSeconds = useBootstrap().data?.parentIdleTimeoutSeconds ?? DEFAULT_IDLE_SECONDS
  const onIdleRef = useRef(opts.onIdle)
  const exitRef = useRef(exitParentMode)
  useEffect(() => {
    onIdleRef.current = opts.onIdle
    exitRef.current = exitParentMode
  })

  useEffect(() => {
    if (mode !== 'parent') return
    let idleTimer: ReturnType<typeof setTimeout> | undefined
    let lastTouch = Date.now()
    let stopped = false

    const arm = () => {
      clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        if (stopped) return
        stopped = true
        void exitRef.current().then(() => onIdleRef.current())
      }, idleSeconds * 1000)
    }
    const onActivity = () => {
      if (stopped) return
      arm()
      const now = Date.now()
      if (now - lastTouch >= TOUCH_INTERVAL_MS) {
        lastTouch = now
        void Promise.resolve(api.POST('/api/parent/session/touch')).catch(() => {})
      }
    }

    const events = ['pointerdown', 'keydown', 'touchstart'] as const
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }))
    arm()
    return () => {
      stopped = true
      clearTimeout(idleTimer)
      events.forEach((e) => window.removeEventListener(e, onActivity))
    }
  }, [mode, idleSeconds])
}
