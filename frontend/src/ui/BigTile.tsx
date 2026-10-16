import { useRef, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { useReducedMotion } from './useReducedMotion'

export const DOUBLE_TAP_GUARD_MS = 600

export type BigTileProps = {
  icon: ReactNode
  label: string
  pressed?: boolean
  disabled?: boolean
  busy?: boolean
  color?: string
  onPress(): void
  className?: string
}

export function BigTile({ icon, label, pressed = false, disabled = false, busy = false, color, onPress, className = '' }: BigTileProps) {
  const lastPress = useRef(Number.NEGATIVE_INFINITY)
  const reduced = useReducedMotion()
  const fill = color ?? 'var(--child-color, #FFB703)'

  const handle = () => {
    if (disabled || busy) return
    const now = Date.now()
    if (now - lastPress.current < DOUBLE_TAP_GUARD_MS) return
    lastPress.current = now
    onPress()
  }

  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-busy={busy || undefined}
      disabled={disabled}
      onClick={handle}
      style={pressed ? { backgroundColor: fill } : undefined}
      className={`relative flex min-h-[72px] min-w-[72px] flex-col items-center justify-center gap-2 rounded-[2rem] border-4 px-4 py-4 text-center text-[1.4rem] font-bold leading-tight text-ink shadow-[0_6px_0_rgba(27,27,47,0.18)] transition touch-manipulation select-none focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-ink disabled:opacity-60 ${
        pressed ? 'border-ink' : 'border-ink/25 bg-white'
      } ${busy ? 'opacity-80' : ''} ${className}`}
    >
      <motion.span
        aria-hidden="true"
        key={pressed ? 'done' : 'todo'}
        className="flex min-h-14 min-w-14 items-center justify-center text-5xl"
        initial={pressed && !reduced ? { scale: 0.6 } : false}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 500, damping: 12 }}
      >
        {icon}
      </motion.span>
      <span>{label}</span>
      {pressed && (
        <span
          data-testid="done-badge"
          aria-hidden="true"
          className="absolute -right-2 -top-2 flex h-10 w-10 items-center justify-center rounded-full border-4 border-ink bg-white text-xl font-bold text-ink"
        >
          ✓
        </span>
      )}
    </button>
  )
}
