import confetti from 'canvas-confetti'

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

const CONFETTI_COLORS = ['#FFB703', '#FB8500', '#FF6B8B', '#F7A8D8', '#B388EB', '#4CC9F0', '#56CFA1', '#8BC34A']

function glow(durationMs: number): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve()
  const el = document.createElement('div')
  el.setAttribute('aria-hidden', 'true')
  el.style.cssText =
    'position:fixed;inset:0;pointer-events:none;z-index:9999;opacity:0;' +
    'background:radial-gradient(circle at center, rgba(255,183,3,0.55), rgba(255,248,231,0) 70%)'
  document.body.appendChild(el)
  if (typeof el.animate === 'function') {
    try {
      el.animate([{ opacity: 0 }, { opacity: 1, offset: 0.4 }, { opacity: 0 }], {
        duration: durationMs,
        easing: 'ease-in-out',
      })
    } catch {
      /* ignore */
    }
  }
  return new Promise((resolve) => {
    setTimeout(() => {
      el.remove()
      resolve()
    }, durationMs)
  })
}

/** About 2.5 s of confetti bursts; a gentle glow when reduced motion is requested. Resolves when done. */
export function celebrateRoutine(): Promise<void> {
  if (prefersReducedMotion()) return glow(1200)
  const total = 2500
  return new Promise((resolve) => {
    const fire = (originX: number) => {
      try {
        void confetti({
          particleCount: 40,
          spread: 75,
          startVelocity: 45,
          origin: { x: originX, y: 0.7 },
          colors: CONFETTI_COLORS,
          disableForReducedMotion: true,
        })
      } catch {
        /* canvas unavailable */
      }
    }
    fire(0.5)
    const id = setInterval(() => fire(0.15 + Math.random() * 0.7), 400)
    setTimeout(() => {
      clearInterval(id)
      resolve()
    }, total)
  })
}

/** Small bounce on an element. No-op without reduced-motion friendliness or the Web Animations API. */
export function celebrateTask(target?: HTMLElement | null): void {
  if (!target || prefersReducedMotion() || typeof target.animate !== 'function') return
  try {
    target.animate(
      [
        { transform: 'scale(1)' },
        { transform: 'scale(1.18) rotate(-4deg)', offset: 0.35 },
        { transform: 'scale(0.96) rotate(2deg)', offset: 0.65 },
        { transform: 'scale(1)' },
      ],
      { duration: 450, easing: 'ease-out' },
    )
  } catch {
    /* ignore */
  }
}
