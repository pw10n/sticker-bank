import type { components } from './schema'
import type { ChartSticker } from './types'

export type ErrorCode = components['schemas']['ErrorCode']

export interface Problem {
  type?: string
  title?: string
  status: number
  detail?: string
  code?: ErrorCode
  attemptsRemaining?: number
  retryAfterSeconds?: number
  today?: string
  sticker?: ChartSticker
  fieldErrors?: { field: string; message: string }[]
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'NETWORK' | 'UNKNOWN',
    readonly problem?: Problem,
  ) {
    super(problem?.detail ?? problem?.title ?? `${code} (${status})`)
    this.name = 'ApiError'
  }
}

export function isApiError(e: unknown, code?: ApiError['code']): e is ApiError {
  return e instanceof ApiError && (code === undefined || e.code === code)
}
