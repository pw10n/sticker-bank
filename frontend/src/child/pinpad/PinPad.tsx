import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { motion } from 'motion/react'
import { useReducedMotion } from '../../ui'
import { formatCountdown } from './pinErrors'

const PIN_LENGTH = 4
const FOCUSABLE = 'button:not([disabled]),[tabindex]:not([tabindex="-1"])'
const DIGIT_ROWS = [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9']]

export interface PinPadProps {
  title: string
  subtitle?: string
  onComplete(pin: string): void
  error?: string
  busy?: boolean
  lockedSeconds?: number
  onCancel?(): void
  /** Label of the cancel button (defaults to "Cancel"). */
  cancelLabel?: string
}

const KEY =
  'flex h-[72px] w-[72px] items-center justify-center rounded-full border-2 border-ink/20 bg-white text-3xl font-bold text-ink shadow-[0_3px_0_rgba(27,27,47,0.12)] touch-manipulation select-none active:translate-y-0.5 active:shadow-none disabled:opacity-40 focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-ink'

export function PinPad({ title, subtitle, onComplete, error, busy = false, lockedSeconds = 0, onCancel, cancelLabel = 'Cancel' }: PinPadProps) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const digitsRef = useRef('')
  const [count, setCount] = useState(0)
  const [remaining, setRemaining] = useState(lockedSeconds)
  const [prevLocked, setPrevLocked] = useState(lockedSeconds)
  if (prevLocked !== lockedSeconds) {
    setPrevLocked(lockedSeconds)
    setRemaining(lockedSeconds)
  }
  const reduced = useReducedMotion()
  const onCompleteRef = useRef(onComplete)
  useEffect(() => {
    onCompleteRef.current = onComplete
  })

  // Live countdown that re-enables the keypad at 0.
  useEffect(() => {
    if (!(lockedSeconds > 0)) return
    const id = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          clearInterval(id)
          return 0
        }
        return r - 1
      })
    }, 1000)
    return () => clearInterval(id)
  }, [lockedSeconds])

  const locked = remaining > 0
  const disabled = locked || busy
  const shown = disabled ? 0 : count
  const disabledRef = useRef(disabled)
  useEffect(() => {
    disabledRef.current = disabled
    if (disabled) digitsRef.current = ''
  }, [disabled])

  useEffect(() => {
    dialogRef.current?.focus()
  }, [])

  const press = useCallback((d: string) => {
    if (disabledRef.current || digitsRef.current.length >= PIN_LENGTH) return
    digitsRef.current += d
    if (digitsRef.current.length === PIN_LENGTH) {
      const pin = digitsRef.current
      digitsRef.current = ''
      setCount(0)
      onCompleteRef.current(pin)
    } else {
      setCount(digitsRef.current.length)
    }
  }, [])

  const backspace = useCallback(() => {
    if (disabledRef.current) return
    digitsRef.current = digitsRef.current.slice(0, -1)
    setCount(digitsRef.current.length)
  }, [])

  // Physical keyboard.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return
      if (/^\d$/.test(e.key)) {
        e.preventDefault()
        press(e.key)
      } else if (e.key === 'Backspace') {
        e.preventDefault()
        backspace()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [press, backspace])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && onCancel) {
      e.stopPropagation()
      onCancel()
      return
    }
    if (e.key !== 'Tab') return
    const dialog = dialogRef.current
    if (!dialog) return
    const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE))
    if (items.length === 0) {
      e.preventDefault()
      dialog.focus()
      return
    }
    const first = items[0]
    const last = items[items.length - 1]
    const active = document.activeElement
    if (e.shiftKey && (active === first || active === dialog)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }

  const shake = error && !reduced ? { x: [0, -12, 12, -8, 8, -4, 0] } : undefined

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="mx-auto flex w-full max-w-sm flex-col items-center gap-5 rounded-[2rem] bg-white p-6 text-ink shadow-[0_6px_0_rgba(27,27,47,0.1)] outline-none"
    >
      <div className="text-center">
        <h1 id={titleId} className="text-2xl font-bold">
          {title}
        </h1>
        {subtitle && <p className="mt-1 text-base">{subtitle}</p>}
      </div>

      <motion.div
        key={error ?? 'ok'}
        animate={shake}
        transition={{ duration: 0.45 }}
        role="img"
        aria-label={`${shown} of ${PIN_LENGTH} digits entered`}
        className="flex gap-4"
      >
        {Array.from({ length: PIN_LENGTH }, (_, i) => (
          <span
            key={i}
            aria-hidden="true"
            className={`h-5 w-5 rounded-full border-2 border-ink ${i < shown ? 'bg-ink' : 'bg-transparent'}`}
          />
        ))}
      </motion.div>

      <div aria-live="assertive" className="min-h-14 text-center text-base font-bold">
        {locked ? (
          <>
            {error && <p>{error}</p>}
            <p>Try again in {formatCountdown(remaining)}</p>
          </>
        ) : (
          error && <p>{error}</p>
        )}
      </div>

      <div className="grid grid-cols-3 gap-4" role="group" aria-label="PIN keypad">
        {DIGIT_ROWS.flat().map((d) => (
          <button key={d} type="button" className={KEY} disabled={disabled} onClick={() => press(d)}>
            {d}
          </button>
        ))}
        <span aria-hidden="true" />
        <button type="button" className={KEY} disabled={disabled} onClick={() => press('0')}>
          0
        </button>
        <button type="button" className={KEY} disabled={disabled} onClick={backspace} aria-label="Backspace">
          <span aria-hidden="true">⌫</span>
        </button>
      </div>

      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="min-h-11 rounded-2xl px-5 text-base font-bold underline underline-offset-4 focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          {cancelLabel}
        </button>
      )}
    </div>
  )
}
