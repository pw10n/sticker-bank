import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useDeviceSettings } from '../app/deviceSettingsContext'
import { SoundContext, type SoundApi } from './soundContext'
import { synthesize } from './synth'



type AudioCtor = typeof AudioContext

function audioCtor(): AudioCtor | undefined {
  const w = globalThis as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor }
  return w.AudioContext ?? w.webkitAudioContext
}

export function SoundProvider({ children }: { children: ReactNode }) {
  const { soundsOn } = useDeviceSettings()
  const ctxRef = useRef<AudioContext | null>(null)
  const soundsOnRef = useRef(soundsOn)
  useEffect(() => {
    soundsOnRef.current = soundsOn
  })

  const api = useMemo<SoundApi>(() => {
    const getContext = (): AudioContext | null => {
      if (ctxRef.current) return ctxRef.current
      const Ctor = audioCtor()
      if (!Ctor) return null
      try {
        ctxRef.current = new Ctor()
      } catch {
        return null
      }
      return ctxRef.current
    }
    return {
      play(name) {
        if (!soundsOnRef.current) return
        try {
          const ctx = getContext()
          if (!ctx) return
          if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
          synthesize(ctx, name)
        } catch {
          /* sound is never worth a crash */
        }
      },
    }
  }, [])

  // iOS only lets audio start from a user gesture: unlock on the first pointerdown.
  useEffect(() => {
    const unlock = () => {
      try {
        const Ctor = audioCtor()
        if (!Ctor) return
        ctxRef.current ??= new Ctor()
        if (ctxRef.current.state === 'suspended') void ctxRef.current.resume().catch(() => {})
      } catch {
        /* ignore */
      }
      window.removeEventListener('pointerdown', unlock)
    }
    window.addEventListener('pointerdown', unlock, { passive: true })
    return () => window.removeEventListener('pointerdown', unlock)
  }, [])

  return <SoundContext.Provider value={api}>{children}</SoundContext.Provider>
}
