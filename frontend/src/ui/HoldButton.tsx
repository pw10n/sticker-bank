import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Badge } from './Badge'

export type HoldButtonProps = {
  label: string
  holdMs?: number
  onHoldComplete(): void
  badge?: number
  children: ReactNode
  className?: string
}

export function HoldButton({ label, holdMs = 1000, onHoldComplete, badge, children, className = '' }: HoldButtonProps) {
  const [holding, setHolding] = useState(false)
  const descId = useId()
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cbRef = useRef(onHoldComplete)
  useEffect(() => {
    cbRef.current = onHoldComplete
  })

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    setHolding(false)
  }, [])

  const start = useCallback(() => {
    if (timer.current) return
    setHolding(true)
    timer.current = setTimeout(() => {
      timer.current = null
      setHolding(false)
      cbRef.current()
    }, holdMs)
  }, [holdMs])

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (!e.repeat) start()
    }
  }
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') cancel()
  }

  return (
    <button
      type="button"
      aria-label={label}
      aria-describedby={descId}
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onBlur={cancel}
      onContextMenu={(e) => e.preventDefault()}
      className={`relative inline-flex min-h-[72px] min-w-[72px] items-center justify-center gap-2 overflow-hidden rounded-full border-4 border-ink/30 bg-white px-4 font-bold text-ink shadow-[0_4px_0_rgba(27,27,47,0.15)] touch-manipulation select-none focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-ink ${className}`}
    >
      <span
        data-testid="hold-fill"
        data-holding={holding}
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-full origin-left bg-sunshine/70"
        style={{
          transform: holding ? 'scaleX(1)' : 'scaleX(0)',
          transition: holding ? `transform ${holdMs}ms linear` : 'transform 150ms ease-out',
        }}
      />
      <span className="relative flex items-center gap-2">{children}</span>
      <span id={descId} className="sr-only">
        {badge !== undefined && badge > 0 ? `${badge} waiting. ` : ''}Press and hold to open
      </span>
      {badge !== undefined && badge > 0 && (
        <span aria-hidden="true" className="absolute right-1 top-1">
          <Badge count={badge} />
        </span>
      )}
    </button>
  )
}
