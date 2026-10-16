import { http, HttpResponse, type JsonBodyType, type PathParams, type RequestHandler } from 'msw'
import './fakeApi'
import * as fake from './fakeState'
import { FakeApiError, getState } from './fakeState'

interface Ctx {
  params: PathParams
  url: URL
  body: () => Promise<unknown>
}

const CSRF_HEADER = 'X-Sticker-Bank'

function problem(e: FakeApiError): Response {
  const headers: Record<string, string> = { 'Content-Type': 'application/problem+json' }
  if (e.extras.retryAfterSeconds !== undefined) headers['Retry-After'] = String(e.extras.retryAfterSeconds)
  return HttpResponse.json(e.toProblem(), { status: e.status, headers })
}

/** `/api/parent/**` needs a session, except for PIN setup and unlock. */
function needsParentSession(method: string, pathname: string): boolean {
  if (!pathname.startsWith('/api/parent/')) return false
  if (method === 'POST' && (pathname === '/api/parent/pin' || pathname === '/api/parent/session')) return false
  return true
}

function route<T extends JsonBodyType | void>(successStatus: number, fn: (ctx: Ctx) => T | Promise<T>) {
  return async ({ request, params }: { request: Request; params: PathParams }): Promise<Response> => {
    const url = new URL(request.url)
    try {
      if (request.method !== 'GET' && request.headers.get(CSRF_HEADER) !== '1') {
        throw new FakeApiError(403, 'CSRF_HEADER_MISSING', `Missing ${CSRF_HEADER} header`)
      }
      if (needsParentSession(request.method, url.pathname)) fake.requireParentSession()
      const result = await fn({
        params,
        url,
        body: async () => request.json().catch(() => null) as Promise<unknown>,
      })
      if (successStatus === 204) return new HttpResponse(null, { status: 204 })
      return HttpResponse.json(result as JsonBodyType, { status: successStatus })
    } catch (e) {
      if (e instanceof FakeApiError) return problem(e)
      throw e
    }
  }
}

function idParam(ctx: Ctx, name: string): number {
  const raw = ctx.params[name]
  const value = Number(Array.isArray(raw) ? raw[0] : raw)
  if (!Number.isInteger(value)) throw new FakeApiError(404, 'NOT_FOUND', 'Not found')
  return value
}

function strParam(ctx: Ctx, name: string): string {
  const raw = ctx.params[name]
  return String(Array.isArray(raw) ? raw[0] : raw)
}

function intQuery(ctx: Ctx, name: string): number | null {
  const raw = ctx.url.searchParams.get(name)
  if (raw === null || raw === '') return null
  const value = Number(raw)
  if (!Number.isInteger(value)) {
    throw new FakeApiError(400, 'VALIDATION_FAILED', 'Validation failed', {
      fieldErrors: [{ field: name, message: 'must be an integer' }],
    })
  }
  return value
}

const q = (ctx: Ctx, name: string): string | null => ctx.url.searchParams.get(name)

export const handlers: RequestHandler[] = [
  // "offline" scenario: every API call fails like a dead network. Otherwise fall through.
  http.all('*/api/*', () => (getState().offline ? HttpResponse.error() : undefined)),

  // Bootstrap and children's day
  http.get('*/api/bootstrap', route(200, () => fake.getBootstrap())),
  http.get(
    '*/api/children/:childId/days/:date',
    route(200, (c) => fake.getDailyChart(idParam(c, 'childId'), strParam(c, 'date'))),
  ),
  http.put(
    '*/api/children/:childId/days/:date/tasks/:taskId',
    route(200, (c) => fake.completeTask(idParam(c, 'childId'), strParam(c, 'date'), idParam(c, 'taskId'))),
  ),
  http.delete(
    '*/api/children/:childId/days/:date/tasks/:taskId',
    route(200, async (c) => {
      const body = (await c.body()) as { note?: string | null } | null
      return fake.uncompleteTask(idParam(c, 'childId'), strParam(c, 'date'), idParam(c, 'taskId'), {
        revokeSticker: q(c, 'revokeSticker') === 'true',
        note: body?.note ?? null,
      })
    }),
  ),

  // Stickers
  http.get('*/api/stickers/:stickerId/pick', route(200, (c) => fake.getStickerPick(idParam(c, 'stickerId')))),
  http.post(
    '*/api/stickers/:stickerId/pick',
    route(200, async (c) => fake.claimStickerPick(idParam(c, 'stickerId'), await c.body())),
  ),
  http.get(
    '*/api/children/:childId/stickers',
    route(200, (c) =>
      fake.getStickerBook(idParam(c, 'childId'), {
        status: q(c, 'status'),
        cursor: q(c, 'cursor'),
        limit: intQuery(c, 'limit'),
      }),
    ),
  ),
  http.get('*/api/stickers/:stickerId', route(200, (c) => fake.getStickerDetail(idParam(c, 'stickerId')))),

  // Prize requests (child side)
  http.get(
    '*/api/children/:childId/prize-requests/pending',
    route(200, (c) => fake.getPendingPrizeRequest(idParam(c, 'childId'))),
  ),
  http.post(
    '*/api/children/:childId/prize-requests',
    route(201, async (c) => fake.createPrizeRequest(idParam(c, 'childId'), await c.body())),
  ),
  http.post(
    '*/api/prize-requests/:requestId/cancel',
    route(200, (c) => fake.cancelPrizeRequest(idParam(c, 'requestId'))),
  ),

  // PIN, session, settings
  http.post('*/api/parent/pin', route(201, async (c) => fake.setupPin(await c.body()))),
  http.put(
    '*/api/parent/pin',
    route(204, async (c) => {
      fake.changePin(await c.body())
    }),
  ),
  http.post('*/api/parent/session', route(200, async (c) => fake.unlock(await c.body()))),
  http.get('*/api/parent/session', route(200, () => fake.getParentSession())),
  http.delete(
    '*/api/parent/session',
    route(204, () => {
      fake.lockParentMode()
    }),
  ),
  http.post('*/api/parent/session/touch', route(200, () => fake.touchParentSession())),
  http.get('*/api/parent/settings', route(200, () => fake.getSettings())),
  http.put('*/api/parent/settings', route(200, async (c) => fake.updateSettings(await c.body()))),

  // Children
  http.get('*/api/parent/children', route(200, () => fake.listChildren())),
  http.post('*/api/parent/children', route(201, async (c) => fake.createChild(await c.body()))),
  http.put(
    '*/api/parent/children/:childId',
    route(200, async (c) => fake.updateChild(idParam(c, 'childId'), await c.body())),
  ),
  http.delete(
    '*/api/parent/children/:childId',
    route(204, (c) => {
      fake.deleteChild(idParam(c, 'childId'))
    }),
  ),

  // Routines
  http.get(
    '*/api/parent/children/:childId/routines',
    route(200, (c) => fake.listRoutines(idParam(c, 'childId'))),
  ),
  http.post(
    '*/api/parent/children/:childId/routines',
    route(201, async (c) => fake.createRoutine(idParam(c, 'childId'), await c.body())),
  ),
  http.put(
    '*/api/parent/children/:childId/routines/order',
    route(204, async (c) => {
      fake.reorderRoutines(idParam(c, 'childId'), await c.body())
    }),
  ),
  http.get('*/api/parent/routines/:routineId', route(200, (c) => fake.getRoutine(idParam(c, 'routineId')))),
  http.put(
    '*/api/parent/routines/:routineId',
    route(200, async (c) => fake.updateRoutine(idParam(c, 'routineId'), await c.body())),
  ),
  http.delete('*/api/parent/routines/:routineId', route(200, (c) => fake.deleteRoutine(idParam(c, 'routineId')))),
  http.post(
    '*/api/parent/routines/:routineId/copy',
    route(201, async (c) => fake.copyRoutine(idParam(c, 'routineId'), await c.body())),
  ),
  http.put(
    '*/api/parent/routines/:routineId/skips/:date',
    route(204, (c) => {
      fake.addRoutineSkip(idParam(c, 'routineId'), strParam(c, 'date'))
    }),
  ),
  http.delete(
    '*/api/parent/routines/:routineId/skips/:date',
    route(204, (c) => {
      fake.removeRoutineSkip(idParam(c, 'routineId'), strParam(c, 'date'))
    }),
  ),

  // History
  http.get(
    '*/api/parent/children/:childId/history',
    route(200, (c) => fake.getHistory(idParam(c, 'childId'), q(c, 'from') ?? undefined, q(c, 'to') ?? undefined)),
  ),

  // Library
  http.get(
    '*/api/parent/library/designs',
    route(200, (c) =>
      fake.listDesigns({ q: q(c, 'q'), status: q(c, 'status'), categoryId: intQuery(c, 'categoryId') }),
    ),
  ),
  http.post('*/api/parent/library/designs', route(201, async (c) => fake.createDesign(await c.body()))),
  http.put(
    '*/api/parent/library/designs/:designId',
    route(200, async (c) => fake.updateDesign(idParam(c, 'designId'), await c.body())),
  ),
  http.delete(
    '*/api/parent/library/designs/:designId',
    route(204, (c) => {
      fake.deleteDesign(idParam(c, 'designId'))
    }),
  ),
  http.put(
    '*/api/parent/library/designs/:designId/status',
    route(200, async (c) => fake.setDesignStatus(idParam(c, 'designId'), await c.body())),
  ),
  http.get('*/api/parent/library/categories', route(200, () => fake.listCategories())),
  http.post('*/api/parent/library/categories', route(201, async (c) => fake.createCategory(await c.body()))),
  http.put(
    '*/api/parent/library/categories/:categoryId',
    route(200, async (c) => fake.updateCategory(idParam(c, 'categoryId'), await c.body())),
  ),
  http.delete(
    '*/api/parent/library/categories/:categoryId',
    route(204, (c) => {
      fake.deleteCategory(idParam(c, 'categoryId'))
    }),
  ),

  // Prize requests (parent side)
  http.get(
    '*/api/parent/prize-requests',
    route(200, (c) =>
      fake.listPrizeRequests({
        status: c.url.searchParams.getAll('status'),
        childId: intQuery(c, 'childId'),
        cursor: q(c, 'cursor'),
        limit: intQuery(c, 'limit'),
      }),
    ),
  ),
  http.post(
    '*/api/parent/prize-requests/:requestId/complete',
    route(200, async (c) => fake.completePrizeRequest(idParam(c, 'requestId'), await c.body())),
  ),
  http.put(
    '*/api/parent/prize-requests/:requestId',
    route(200, async (c) => fake.editPrizeRequest(idParam(c, 'requestId'), await c.body())),
  ),
]
