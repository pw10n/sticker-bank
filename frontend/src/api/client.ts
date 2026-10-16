import createClient, { type Middleware } from 'openapi-fetch'
import { ApiError, type Problem } from './errors'
import { MIN_FRONTEND_VERSION_HEADER, reportMinFrontendVersion } from './minFrontendVersion'
import type { paths } from './schema'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** Every state-changing request carries the CSRF custom header the backend requires. */
const csrfHeader: Middleware = {
  onRequest({ request }) {
    if (!SAFE_METHODS.has(request.method.toUpperCase())) {
      request.headers.set('X-Sticker-Bank', '1')
    }
    return request
  },
}

export const api = createClient<paths>({
  baseUrl: globalThis.location?.origin ?? 'http://localhost',
  // Looked up lazily so MSW's patched fetch is used in tests.
  fetch: (req) => globalThis.fetch(req),
  credentials: 'same-origin',
})
api.use(csrfHeader)

/** Remembers the minimum frontend version the server announces, on errors too, so a stale app learns of it on any call. */
const minFrontendVersion: Middleware = {
  onResponse({ response }) {
    const announced = response.headers.get(MIN_FRONTEND_VERSION_HEADER)?.trim()
    if (announced) reportMinFrontendVersion(announced)
    return response
  },
}
api.use(minFrontendVersion)

type Result<T> = { data?: T; error?: unknown; response: Response }

/** Resolves with the response body, or throws an ApiError (NETWORK when the request never completed). */
export async function unwrap<T>(p: Promise<Result<T>>): Promise<T> {
  let result: Result<T>
  try {
    result = await p
  } catch (e) {
    if (e instanceof ApiError) throw e
    throw new ApiError(0, 'NETWORK')
  }
  const { data, error, response } = result
  if (!response.ok) {
    const problem = (error ?? undefined) as Problem | undefined
    throw new ApiError(response.status, problem?.code ?? 'UNKNOWN', problem)
  }
  return data as T
}
