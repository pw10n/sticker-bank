import { isApiError } from '../../api/errors'

export interface PinErrorInfo {
  /** Gentle, human message. */
  message: string
  /** Set when the PIN is now locked out (FR-8.7). */
  lockedSeconds?: number
}

export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

/** Maps a PIN-related API error to a message (and a lockout, when there is one). */
export function describePinError(e: unknown): PinErrorInfo {
  if (isApiError(e, 'PIN_INCORRECT')) {
    const retry = e.problem?.retryAfterSeconds
    if (retry !== undefined && retry > 0) {
      return { message: 'That’s not it. Too many tries, so let’s take a short break.', lockedSeconds: retry }
    }
    const n = e.problem?.attemptsRemaining
    if (n === undefined) return { message: 'That’s not it. Try again.' }
    return { message: `That’s not it — ${n} ${n === 1 ? 'try' : 'tries'} left` }
  }
  if (isApiError(e, 'PIN_LOCKED')) {
    return {
      message: 'Too many tries, so let’s take a short break.',
      lockedSeconds: e.problem?.retryAfterSeconds ?? 60,
    }
  }
  return { message: 'Something went wrong. Please try again.' }
}
