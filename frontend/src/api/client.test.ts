import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../mocks/server'
import { api, unwrap } from './client'
import { ApiError, isApiError } from './errors'

describe('api client', () => {
  it('adds X-Sticker-Bank to non-GET requests only', async () => {
    const seen: Record<string, string | null> = {}
    server.use(
      http.get('*/api/parent/settings', ({ request }) => {
        seen.GET = request.headers.get('X-Sticker-Bank')
        return HttpResponse.json({ timeZone: 'UTC', parentIdleTimeoutSeconds: 300, pinSetAt: null, lastPinReset: null })
      }),
      http.post('*/api/parent/session/touch', ({ request }) => {
        seen.POST = request.headers.get('X-Sticker-Bank')
        return HttpResponse.json({
          idleTimeoutSeconds: 300,
          idleExpiresAt: '2026-10-15T15:05:00Z',
          absoluteExpiresAt: '2026-10-16T03:00:00Z',
        })
      }),
    )
    await unwrap(api.GET('/api/parent/settings'))
    await unwrap(api.POST('/api/parent/session/touch'))
    expect(seen.GET).toBeNull()
    expect(seen.POST).toBe('1')
  })

  it('maps a problem+json error to ApiError with its code', async () => {
    server.use(
      http.post('*/api/parent/session/touch', () =>
        HttpResponse.json(
          { title: 'Conflict', status: 409, code: 'ROUTINE_LOCKED', detail: 'This routine is finished for today' },
          { status: 409, headers: { 'Content-Type': 'application/problem+json' } },
        ),
      ),
    )
    const error = await unwrap(api.POST('/api/parent/session/touch')).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(isApiError(error, 'ROUTINE_LOCKED')).toBe(true)
    expect((error as ApiError).status).toBe(409)
    expect((error as ApiError).problem?.detail).toBe('This routine is finished for today')
  })

  it('maps an unknown error body to UNKNOWN', async () => {
    server.use(http.get('*/api/bootstrap', () => new HttpResponse('boom', { status: 500 })))
    const error = await unwrap(api.GET('/api/bootstrap')).catch((e: unknown) => e)
    expect(isApiError(error, 'UNKNOWN')).toBe(true)
  })

  it('maps a network failure to NETWORK', async () => {
    server.use(http.get('*/api/bootstrap', () => HttpResponse.error()))
    const error = await unwrap(api.GET('/api/bootstrap')).catch((e: unknown) => e)
    expect(isApiError(error, 'NETWORK')).toBe(true)
    expect((error as ApiError).status).toBe(0)
  })

  it('returns undefined for 204', async () => {
    server.use(http.delete('*/api/parent/session', () => new HttpResponse(null, { status: 204 })))
    await expect(unwrap(api.DELETE('/api/parent/session'))).resolves.toBeUndefined()
  })
})
