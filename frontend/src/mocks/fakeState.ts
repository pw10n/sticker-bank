/**
 * In-memory fake of the Sticker Bank backend ("UI only" mode, TDD §12.5).
 *
 * It covers only the main business rules; the real rules are proven by the backend tests.
 * Every operation returns a contract type from `src/api/types.ts`, so API drift fails `tsc`.
 * Operations throw `FakeApiError`, which the handlers turn into `application/problem+json`.
 */
import type { ErrorCode } from '../api/errors'
import type {
  Actor,
  Bootstrap,
  BookSticker,
  Category,
  Child,
  ChartRoutine,
  DailyChart,
  Design,
  DesignRef,
  DesignStatus,
  FieldError,
  History,
  HistoryDay,
  Library,
  PendingPrizeRequest,
  PrizeCancelReason,
  ParentSession,
  PrizeRequest,
  PrizeRequestPage,
  PrizeRequestStatus,
  ProblemDetail,
  Routine,
  RoutineDayState,
  Revocation,
  RoutineDeleteResult,
  RoutineSaveResult,
  Settings,
  StickerBookPage,
  StickerCounts,
  StickerDetail,
  StickerPick,
  StickerSource,
  StickerStatus,
  Task,
  TaskToggleResult,
  Weekday,
} from '../api/types'

// ---------------------------------------------------------------------------------------------
// Errors

export type ProblemExtras = Partial<
  Pick<ProblemDetail, 'attemptsRemaining' | 'retryAfterSeconds' | 'today' | 'fieldErrors' | 'detail' | 'sticker'>
>

export class FakeApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    readonly title: string,
    readonly extras: ProblemExtras = {},
  ) {
    super(title)
    this.name = 'FakeApiError'
  }

  toProblem(): ProblemDetail {
    return { type: 'about:blank', title: this.title, status: this.status, code: this.code, ...this.extras }
  }
}

const notFound = (what: string) => new FakeApiError(404, 'NOT_FOUND', `${what} not found`)
const conflict = (code: ErrorCode, title: string, extras?: ProblemExtras) =>
  new FakeApiError(409, code, title, extras)
const invalid = (errors: FieldError[]) =>
  new FakeApiError(400, 'VALIDATION_FAILED', 'Validation failed', { fieldErrors: errors })

// ---------------------------------------------------------------------------------------------
// State shape

export interface FakeSettings {
  pin: string | null
  pinSetAt: string | null
  timeZone: string
  idleTimeoutSeconds: number
  failedAttempts: number
  lockedUntil: number | null
}

export interface FakeChild {
  id: number
  name: string
  avatarKey: string
  themeColor: string
  position: number
  createdAt: string
  /** Last day whose end-of-day auto-finish has been applied (TDD 7.12). `null` = never settled. */
  settledThrough: string | null
}

export interface FakeTask {
  id: number
  label: string
  iconKey: string
  position: number
}

export interface FakeRoutine {
  id: number
  childId: number
  position: number
  name: string
  iconKey: string
  color: string | null
  days: Weekday[]
  paused: boolean
  effectiveFrom: string
  tasks: FakeTask[]
  upcomingSkips: string[]
}

export interface FakeSticker {
  id: number
  childId: number
  routineId: number | null
  chartDate: string
  routineName: string | null
  routineIconKey: string | null
  source: StickerSource
  status: StickerStatus
  designId: number | null
  choices: number[]
  autoAwarded: boolean
  prizeRequestId: number | null
  earnedAt: string
  claimedAt: string | null
  /** How the sticker was finished (FR-6.11). `null` for seeded stickers and bonus stickers. */
  finishMode: 'TAPPED' | 'AUTO' | null
}

export interface FakePrizeRequest {
  id: number
  childId: number
  status: PrizeRequestStatus
  createdBy: Actor
  stickerIds: number[]
  prizeText: string | null
  note: string | null
  createdAt: string
  completedAt: string | null
  cancelledAt: string | null
  cancelledBy: Actor | null
  cancelReason: PrizeCancelReason | null
  reversedAt: string | null
}

export interface FakeDesign {
  id: number
  name: string
  artworkKey: string
  categoryId: number | null
  status: DesignStatus
  isFallback: boolean
  createdAt: string
}

export interface FakeCategory {
  id: number
  name: string
  enabled: boolean
  position: number
}

export type IdKind = 'child' | 'task' | 'routine' | 'sticker' | 'design' | 'category' | 'request' | 'revocation'

export interface FakeState {
  settings: FakeSettings
  parentSession: boolean
  todayOverride: string | null
  offline: boolean
  children: FakeChild[]
  routines: FakeRoutine[]
  /** Completed tasks, keyed `taskId|date`. */
  completions: Set<string>
  stickers: FakeSticker[]
  designs: FakeDesign[]
  categories: FakeCategory[]
  prizeRequests: FakePrizeRequest[]
  revocations: Revocation[]
  nextId: Record<IdKind, number>
  rng: number
}

const FALLBACK_ARTWORK = 'glowing-star'
const SEED_CREATED_AT = '2025-01-01T00:00:00.000Z'
const MAX_PIN_ATTEMPTS = 5
const LOCKOUT_MS = 60_000
const ABSOLUTE_SESSION_MS = 12 * 60 * 60 * 1000
const ALL_DAYS: Weekday[] = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']

/** Mirrors V2__seed_sticker_library.sql. */
const SEED_CATEGORIES: [string, [string, string][]][] = [
  [
    'Animals',
    [
      ['Happy Whale', 'whale'],
      ['Lion', 'lion'],
      ['Panda', 'panda'],
      ['Unicorn', 'unicorn'],
      ['T-Rex', 't-rex'],
      ['Octopus', 'octopus'],
    ],
  ],
  [
    'Space',
    [
      ['Rocket', 'rocket'],
      ['Ringed Planet', 'ringed-planet'],
      ['Shooting Star', 'shooting-star'],
      ['Alien', 'alien'],
      ['Crescent Moon', 'crescent-moon'],
      ['Flying Saucer', 'flying-saucer'],
    ],
  ],
  [
    'Food',
    [
      ['Taco', 'taco'],
      ['Pizza', 'pizza'],
      ['Ice Cream', 'ice-cream'],
      ['Strawberry', 'strawberry'],
      ['Doughnut', 'doughnut'],
      ['Watermelon', 'watermelon'],
    ],
  ],
  [
    'Vehicles',
    [
      ['Race Car', 'racing-car'],
      ['Fire Engine', 'fire-engine'],
      ['Helicopter', 'helicopter'],
      ['Sailboat', 'sailboat'],
      ['Tractor', 'tractor'],
      ['Steam Train', 'locomotive'],
    ],
  ],
]

function createState(): FakeState {
  const s: FakeState = {
    settings: {
      pin: null,
      pinSetAt: null,
      timeZone: 'UTC',
      idleTimeoutSeconds: 300,
      failedAttempts: 0,
      lockedUntil: null,
    },
    parentSession: false,
    todayOverride: null,
    offline: false,
    children: [],
    routines: [],
    completions: new Set(),
    stickers: [],
    designs: [],
    categories: [],
    prizeRequests: [],
    revocations: [],
    nextId: { child: 1, task: 1, routine: 1, sticker: 1, design: 1, category: 1, request: 1, revocation: 1 },
    rng: 42,
  }
  SEED_CATEGORIES.forEach(([name, designs], i) => {
    const categoryId = s.nextId.category++
    s.categories.push({ id: categoryId, name, enabled: true, position: i + 1 })
    for (const [designName, artworkKey] of designs) {
      s.designs.push({
        id: s.nextId.design++,
        name: designName,
        artworkKey,
        categoryId,
        status: 'ACTIVE',
        isFallback: false,
        createdAt: SEED_CREATED_AT,
      })
    }
  })
  s.designs.push({
    id: s.nextId.design++,
    name: 'Gold Star',
    artworkKey: FALLBACK_ARTWORK,
    categoryId: null,
    status: 'ACTIVE',
    isFallback: true,
    createdAt: SEED_CREATED_AT,
  })
  return s
}

let state: FakeState = createState()

/** Replace the whole state with a pristine one (library seeded, nothing else). */
export function resetState(): FakeState {
  state = createState()
  return state
}

export function getState(): FakeState {
  return state
}

const newId = (kind: IdKind): number => state.nextId[kind]++

/** Deterministic mulberry32. */
function random(): number {
  state.rng = (state.rng + 0x6d2b79f5) | 0
  let t = state.rng
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

// ---------------------------------------------------------------------------------------------
// Dates

const pad = (n: number) => String(n).padStart(2, '0')

export function formatLocalDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function parseLocalDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return formatLocalDate(d) === s ? d : null
}

export function addDays(date: string, n: number): string {
  const d = parseLocalDate(date)
  if (!d) throw new Error(`bad date ${date}`)
  d.setDate(d.getDate() + n)
  return formatLocalDate(d)
}

const WEEKDAY_BY_GETDAY: Weekday[] = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

function weekdayOf(date: string): Weekday {
  const d = parseLocalDate(date)
  if (!d) throw new Error(`bad date ${date}`)
  return WEEKDAY_BY_GETDAY[d.getDay()]
}

export function today(): string {
  return state.todayOverride ?? formatLocalDate(new Date())
}

/** A date at local noon, as an ISO instant (stable across time zones for "that day"). */
export function noonIso(date: string): string {
  const d = parseLocalDate(date)
  if (!d) throw new Error(`bad date ${date}`)
  d.setHours(12, 0, 0, 0)
  return d.toISOString()
}

const nowIso = () => new Date().toISOString()

function requireDate(raw: string | undefined, field = 'date'): string {
  if (!raw || !parseLocalDate(raw)) throw invalid([{ field, message: 'must be a date (YYYY-MM-DD)' }])
  return raw
}

function requireNotFuture(date: string): void {
  if (date > today()) throw new FakeApiError(422, 'FUTURE_DATE', 'That day has not happened yet', { today: today() })
}

// ---------------------------------------------------------------------------------------------
// Request validation helpers (bodies arrive as `unknown`)

type Obj = Record<string, unknown>

function asObj(body: unknown): Obj {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw invalid([{ field: 'body', message: 'a JSON object is required' }])
  }
  return body as Obj
}

class Check {
  readonly errors: FieldError[] = []
  constructor(private readonly o: Obj) {}

  str(field: string, max = 80): string {
    const v = this.o[field]
    if (typeof v !== 'string' || v.trim().length === 0 || v.trim().length > max) {
      this.errors.push({ field, message: `must be 1-${max} characters` })
      return ''
    }
    return v.trim()
  }

  int(field: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
    const v = this.o[field]
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
      this.errors.push({ field, message: `must be an integer between ${min} and ${max}` })
      return min
    }
    return v
  }

  done(): void {
    if (this.errors.length > 0) throw invalid(this.errors)
  }
}

function optionalText(o: Obj, field: string): string | null {
  const v = o[field]
  if (v === undefined || v === null) return null
  if (typeof v !== 'string' || v.length > 500) throw invalid([{ field, message: 'must be text up to 500 characters' }])
  return v.trim() === '' ? null : v.trim()
}

// ---------------------------------------------------------------------------------------------
// Lookups

function findChild(id: number): FakeChild {
  const c = state.children.find((x) => x.id === id)
  if (!c) throw notFound('Child')
  return c
}

function findRoutine(id: number): FakeRoutine {
  const r = state.routines.find((x) => x.id === id)
  if (!r) throw notFound('Routine')
  return r
}

function findSticker(id: number): FakeSticker {
  const s = state.stickers.find((x) => x.id === id)
  if (!s) throw notFound('Sticker')
  return s
}

function findDesign(id: number): FakeDesign {
  const d = state.designs.find((x) => x.id === id)
  if (!d) throw notFound('Design')
  return d
}

function findPrizeRequest(id: number): FakePrizeRequest {
  const r = state.prizeRequests.find((x) => x.id === id)
  if (!r) throw notFound('Prize request')
  return r
}

function designRef(id: number): DesignRef {
  const d = findDesign(id)
  return { designId: d.id, name: d.name, artworkKey: d.artworkKey }
}

const fallbackDesign = (): FakeDesign => {
  const d = state.designs.find((x) => x.isFallback)
  if (!d) throw new Error('fallback design missing')
  return d
}

function designPool(): FakeDesign[] {
  return state.designs.filter((d) => {
    if (d.isFallback || d.status !== 'ACTIVE') return false
    if (d.categoryId === null) return true
    return state.categories.find((c) => c.id === d.categoryId)?.enabled === true
  })
}

const doneKey = (taskId: number, date: string) => `${taskId}|${date}`
const sessionActor = (): Actor => (state.parentSession ? 'PARENT' : 'CHILD')

// ---------------------------------------------------------------------------------------------
// Parent guard

export function requireParentSession(): void {
  if (!state.parentSession) {
    throw new FakeApiError(401, 'PARENT_SESSION_REQUIRED', 'Parent Mode is locked')
  }
}

// ---------------------------------------------------------------------------------------------
// Bootstrap, PIN, session, settings

export function getBootstrap(): Bootstrap {
  const t = today()
  const d = parseLocalDate(t)
  if (!d) throw new Error('bad today')
  d.setDate(d.getDate() + 1)
  return {
    setupRequired: state.settings.pin === null,
    today: t,
    nextDayStartsAt: d.toISOString(),
    serverTime: nowIso(),
    timeZone: state.settings.timeZone,
    children: [...state.children]
      .sort((a, b) => a.position - b.position)
      .map((c) => ({ id: c.id, name: c.name, avatarKey: c.avatarKey, themeColor: c.themeColor, position: c.position })),
    pendingPrizeRequestCount: state.prizeRequests.filter((r) => r.status === 'PENDING').length,
    parentIdleTimeoutSeconds: state.settings.idleTimeoutSeconds,
    appVersion: 'mock',
  }
}

function sessionDto(): ParentSession {
  const now = Date.now()
  return {
    idleTimeoutSeconds: state.settings.idleTimeoutSeconds,
    idleExpiresAt: new Date(now + state.settings.idleTimeoutSeconds * 1000).toISOString(),
    absoluteExpiresAt: new Date(now + ABSOLUTE_SESSION_MS).toISOString(),
  }
}

function requirePinFormat(o: Obj, field: string): string {
  const v = o[field]
  if (typeof v !== 'string' || !/^\d{4}$/.test(v)) {
    throw invalid([{ field, message: 'must be exactly 4 digits' }])
  }
  return v
}

function verifyPin(pin: string): void {
  const s = state.settings
  if (s.pin === null) throw conflict('PIN_NOT_SET', 'No PIN has been set up yet')
  const now = Date.now()
  if (s.lockedUntil !== null) {
    if (now < s.lockedUntil) {
      throw new FakeApiError(429, 'PIN_LOCKED', 'Too many wrong PINs. Try again later.', {
        retryAfterSeconds: Math.ceil((s.lockedUntil - now) / 1000),
      })
    }
    s.lockedUntil = null
  }
  if (pin === s.pin) {
    s.failedAttempts = 0
    return
  }
  s.failedAttempts += 1
  if (s.failedAttempts >= MAX_PIN_ATTEMPTS) {
    s.failedAttempts = 0
    s.lockedUntil = now + LOCKOUT_MS
    throw new FakeApiError(401, 'PIN_INCORRECT', 'That PIN is not right', {
      attemptsRemaining: 0,
      retryAfterSeconds: LOCKOUT_MS / 1000,
    })
  }
  throw new FakeApiError(401, 'PIN_INCORRECT', 'That PIN is not right', {
    attemptsRemaining: MAX_PIN_ATTEMPTS - s.failedAttempts,
  })
}

export function setupPin(body: unknown): ParentSession {
  const o = asObj(body)
  const pin = requirePinFormat(o, 'pin')
  const c = new Check(o)
  const timeZone = c.str('timeZone', 64)
  c.done()
  if (state.settings.pin !== null) throw conflict('PIN_ALREADY_SET', 'A PIN is already set')
  state.settings.pin = pin
  state.settings.pinSetAt = nowIso()
  state.settings.timeZone = timeZone
  state.parentSession = true
  return sessionDto()
}

export function changePin(body: unknown): void {
  const o = asObj(body)
  const current = requirePinFormat(o, 'currentPin')
  const next = requirePinFormat(o, 'newPin')
  verifyPin(current)
  state.settings.pin = next
  state.settings.pinSetAt = nowIso()
}

export function unlock(body: unknown): ParentSession {
  const pin = requirePinFormat(asObj(body), 'pin')
  verifyPin(pin)
  state.parentSession = true
  return sessionDto()
}

export const getParentSession = (): ParentSession => sessionDto()
export const touchParentSession = (): ParentSession => sessionDto()

export function lockParentMode(): void {
  state.parentSession = false
}

export function getSettings(): Settings {
  return {
    timeZone: state.settings.timeZone,
    parentIdleTimeoutSeconds: state.settings.idleTimeoutSeconds,
    pinSetAt: state.settings.pinSetAt,
    lastPinReset: null,
  }
}

export function updateSettings(body: unknown): Settings {
  const o = asObj(body)
  const c = new Check(o)
  const timeZone = c.str('timeZone', 64)
  const idle = c.int('parentIdleTimeoutSeconds', 60, 3600)
  c.done()
  state.settings.timeZone = timeZone
  state.settings.idleTimeoutSeconds = idle
  return getSettings()
}

// ---------------------------------------------------------------------------------------------
// Children

const childDto = (c: FakeChild): Child => ({
  id: c.id,
  name: c.name,
  avatarKey: c.avatarKey,
  themeColor: c.themeColor,
  position: c.position,
  createdAt: c.createdAt,
})

function childInput(body: unknown): { name: string; avatarKey: string; themeColor: string } {
  const c = new Check(asObj(body))
  const out = { name: c.str('name', 40), avatarKey: c.str('avatarKey', 64), themeColor: c.str('themeColor', 16) }
  c.done()
  return out
}

export function listChildren(): Child[] {
  return [...state.children].sort((a, b) => a.position - b.position).map(childDto)
}

export function seedChild(input: { name: string; avatarKey: string; themeColor: string }): FakeChild {
  const child: FakeChild = {
    id: newId('child'),
    ...input,
    position: state.children.reduce((m, c) => Math.max(m, c.position), 0) + 1,
    createdAt: nowIso(),
    settledThrough: null,
  }
  state.children.push(child)
  return child
}

export const createChild = (body: unknown): Child => childDto(seedChild(childInput(body)))

export function updateChild(childId: number, body: unknown): Child {
  const child = findChild(childId)
  Object.assign(child, childInput(body))
  return childDto(child)
}

export function deleteChild(childId: number): void {
  findChild(childId)
  const taskIds = new Set(state.routines.filter((r) => r.childId === childId).flatMap((r) => r.tasks.map((t) => t.id)))
  state.children = state.children.filter((c) => c.id !== childId)
  state.routines = state.routines.filter((r) => r.childId !== childId)
  state.stickers = state.stickers.filter((s) => s.childId !== childId)
  state.prizeRequests = state.prizeRequests.filter((r) => r.childId !== childId)
  state.revocations = state.revocations.filter((r) => r.childId !== childId)
  state.completions = new Set([...state.completions].filter((k) => !taskIds.has(Number(k.split('|')[0]))))
}

// ---------------------------------------------------------------------------------------------
// Routines

function routineDto(r: FakeRoutine): Routine {
  const t = today()
  return {
    id: r.id,
    childId: r.childId,
    position: r.position,
    name: r.name,
    iconKey: r.iconKey,
    color: r.color,
    days: [...r.days],
    paused: r.paused,
    effectiveFrom: r.effectiveFrom,
    tasks: r.tasks.map((x): Task => ({ ...x })),
    upcomingSkips: r.upcomingSkips.filter((d) => d >= t).sort(),
  }
}

interface ParsedRoutine {
  name: string
  iconKey: string
  color: string | null
  days: Weekday[]
  paused: boolean
  tasks: { id: number | null; label: string; iconKey: string }[]
}

function parseRoutine(body: unknown): ParsedRoutine {
  const o = asObj(body)
  const c = new Check(o)
  const name = c.str('name', 60)
  const iconKey = c.str('iconKey', 64)
  const color = o.color === null || o.color === undefined ? null : typeof o.color === 'string' ? o.color : undefined
  if (color === undefined) c.errors.push({ field: 'color', message: 'must be text or null' })
  let days: Weekday[] = ALL_DAYS
  if (o.days !== undefined && o.days !== null) {
    if (
      !Array.isArray(o.days) ||
      o.days.length === 0 ||
      !o.days.every((d) => typeof d === 'string' && (ALL_DAYS as string[]).includes(d))
    ) {
      c.errors.push({ field: 'days', message: 'must be a non-empty list of weekdays' })
    } else {
      days = ALL_DAYS.filter((d) => (o.days as string[]).includes(d))
    }
  }
  if (o.paused !== undefined && typeof o.paused !== 'boolean') c.errors.push({ field: 'paused', message: 'must be true or false' })
  const tasks: ParsedRoutine['tasks'] = []
  if (!Array.isArray(o.tasks) || o.tasks.length > 30) {
    c.errors.push({ field: 'tasks', message: 'must be a list of up to 30 tasks' })
  } else {
    o.tasks.forEach((raw: unknown, i) => {
      const t = typeof raw === 'object' && raw !== null ? (raw as Obj) : {}
      const tc = new Check(t)
      const label = tc.str('label', 60)
      const icon = tc.str('iconKey', 64)
      for (const e of tc.errors) c.errors.push({ field: `tasks[${i}].${e.field}`, message: e.message })
      tasks.push({ id: typeof t.id === 'number' ? t.id : null, label, iconKey: icon })
    })
  }
  c.done()
  return { name, iconKey, color: color ?? null, days, paused: o.paused === true, tasks }
}

export function seedRoutine(input: {
  childId: number
  name: string
  iconKey: string
  color?: string | null
  days?: Weekday[]
  paused?: boolean
  tasks: { label: string; iconKey: string }[]
  effectiveFrom?: string
}): FakeRoutine {
  const routine: FakeRoutine = {
    id: newId('routine'),
    childId: input.childId,
    position: state.routines.filter((r) => r.childId === input.childId).reduce((m, r) => Math.max(m, r.position), 0) + 1,
    name: input.name,
    iconKey: input.iconKey,
    color: input.color ?? null,
    days: input.days ?? ALL_DAYS,
    paused: input.paused ?? false,
    effectiveFrom: input.effectiveFrom ?? today(),
    tasks: input.tasks.map((t, i) => ({ id: newId('task'), label: t.label, iconKey: t.iconKey, position: i + 1 })),
    upcomingSkips: [],
  }
  state.routines.push(routine)
  return routine
}

export function listRoutines(childId: number): Routine[] {
  findChild(childId)
  return state.routines
    .filter((r) => r.childId === childId)
    .sort((a, b) => a.position - b.position)
    .map(routineDto)
}

export const getRoutine = (routineId: number): Routine => routineDto(findRoutine(routineId))

function stickerForRoutineDay(routineId: number, date: string): FakeSticker | undefined {
  return state.stickers.find(
    (s) => s.routineId === routineId && s.chartDate === date && s.source === 'ROUTINE' && s.status !== 'REVOKED',
  )
}

function isScheduled(r: FakeRoutine, date: string): boolean {
  return !r.paused && r.tasks.length >= 1 && r.days.includes(weekdayOf(date))
}

function saveResult(r: FakeRoutine): RoutineSaveResult {
  const sticker = stickerForRoutineDay(r.id, today())
  const appliesFromTomorrow = sticker !== undefined
  r.effectiveFrom = appliesFromTomorrow ? addDays(today(), 1) : today()
  return { routine: routineDto(r), effectiveFrom: r.effectiveFrom, appliesFromTomorrow }
}

export function createRoutine(childId: number, body: unknown): RoutineSaveResult {
  findChild(childId)
  const p = parseRoutine(body)
  const r = seedRoutine({ childId, ...p, tasks: p.tasks })
  return saveResult(r)
}

export function updateRoutine(routineId: number, body: unknown): RoutineSaveResult {
  const r = findRoutine(routineId)
  const p = parseRoutine(body)
  const existing = new Map(r.tasks.map((t) => [t.id, t]))
  const kept = new Set<number>()
  r.tasks = p.tasks.map((t, i) => {
    const prev = t.id !== null ? existing.get(t.id) : undefined
    if (prev) kept.add(prev.id)
    return { id: prev ? prev.id : newId('task'), label: t.label, iconKey: t.iconKey, position: i + 1 }
  })
  for (const t of existing.values()) {
    if (kept.has(t.id)) continue
    for (const k of [...state.completions]) if (k.startsWith(`${t.id}|`)) state.completions.delete(k)
  }
  Object.assign(r, { name: p.name, iconKey: p.iconKey, color: p.color, days: p.days, paused: p.paused })
  // Saving never earns a sticker (BR-18). If the edit leaves every task done, the routine is just Ready to finish (I-3).
  return saveResult(r)
}

export function deleteRoutine(routineId: number): RoutineDeleteResult {
  const r = findRoutine(routineId)
  state.routines = state.routines.filter((x) => x.id !== routineId)
  for (const t of r.tasks) state.completions.delete(doneKey(t.id, today()))
  return { routineId, effectiveFrom: addDays(today(), 1) }
}

export function reorderRoutines(childId: number, body: unknown): void {
  findChild(childId)
  const ids = asObj(body).routineIds
  const mine = state.routines.filter((r) => r.childId === childId)
  if (
    !Array.isArray(ids) ||
    ids.length !== mine.length ||
    new Set(ids).size !== ids.length ||
    !ids.every((id) => mine.some((r) => r.id === id))
  ) {
    throw invalid([{ field: 'routineIds', message: "must list each of the child's routines exactly once" }])
  }
  ;(ids as number[]).forEach((id, i) => {
    const r = mine.find((x) => x.id === id)
    if (r) r.position = i + 1
  })
}

export function copyRoutine(routineId: number, body: unknown): Routine {
  const source = findRoutine(routineId)
  const c = new Check(asObj(body))
  const targetChildId = c.int('targetChildId', 1)
  c.done()
  findChild(targetChildId)
  const copy = seedRoutine({
    childId: targetChildId,
    name: source.name,
    iconKey: source.iconKey,
    color: source.color,
    days: [...source.days],
    paused: source.paused,
    tasks: source.tasks,
  })
  return routineDto(copy)
}

export function addRoutineSkip(routineId: number, rawDate: string): void {
  const r = findRoutine(routineId)
  const date = requireDate(rawDate)
  if (stickerForRoutineDay(r.id, date)) {
    throw conflict('ROUTINE_LOCKED', 'This routine already has a sticker for that day')
  }
  if (!r.upcomingSkips.includes(date)) r.upcomingSkips.push(date)
}

export function removeRoutineSkip(routineId: number, rawDate: string): void {
  const r = findRoutine(routineId)
  const date = requireDate(rawDate)
  r.upcomingSkips = r.upcomingSkips.filter((d) => d !== date)
}

// ---------------------------------------------------------------------------------------------
// Daily chart and tasks

function routineState(
  r: FakeRoutine,
  date: string,
  done: number,
  count: number,
  sticker: FakeSticker | undefined,
): RoutineDayState {
  if (r.upcomingSkips.includes(date)) return 'SKIPPED'
  if (sticker) return sticker.status === 'UNCLAIMED' ? 'AWAITING_PICK' : 'EARNED'
  if (count > 0 && done >= count) return 'READY_TO_FINISH'
  if (date < today()) return 'MISSED'
  return done > 0 ? 'IN_PROGRESS' : 'NOT_STARTED'
}

function chartRoutine(r: FakeRoutine, date: string): ChartRoutine {
  const tasks = r.tasks.map((t) => ({
    taskId: t.id,
    label: t.label,
    iconKey: t.iconKey,
    done: state.completions.has(doneKey(t.id, date)),
  }))
  const done = tasks.filter((t) => t.done).length
  const sticker = stickerForRoutineDay(r.id, date)
  return {
    routineId: r.id,
    name: r.name,
    iconKey: r.iconKey,
    color: r.color,
    state: routineState(r, date, done, tasks.length, sticker),
    doneCount: done,
    taskCount: tasks.length,
    tasks,
    sticker: sticker
      ? {
          stickerId: sticker.id,
          status: sticker.status,
          design: sticker.designId !== null ? designRef(sticker.designId) : null,
          prizeRequestId: state.parentSession ? sticker.prizeRequestId : null,
          revocable: state.parentSession ? sticker.status !== 'USED' : null,
          autoFinished: state.parentSession ? sticker.finishMode === 'AUTO' : null,
        }
      : null,
  }
}

function scheduledRoutines(childId: number, date: string): FakeRoutine[] {
  return state.routines
    .filter((r) => r.childId === childId && isScheduled(r, date))
    .sort((a, b) => a.position - b.position)
}

export function getDailyChart(childId: number, rawDate: string): DailyChart {
  findChild(childId)
  const date = rawDate === 'today' ? today() : requireDate(rawDate)
  requireNotFuture(date)
  settleEndedDays(childId)
  return {
    childId,
    date,
    isToday: date === today(),
    routines: scheduledRoutines(childId, date).map((r) => chartRoutine(r, date)),
    unclaimedFromEarlierDays: state.stickers
      .filter((s) => s.childId === childId && s.status === 'UNCLAIMED' && s.chartDate < date)
      .sort((a, b) => a.chartDate.localeCompare(b.chartDate) || a.id - b.id)
      .map((s) => ({
        stickerId: s.id,
        chartDate: s.chartDate,
        routineName: s.routineName,
        routineIconKey: s.routineIconKey,
      })),
  }
}

function pickDto(s: FakeSticker): StickerPick {
  return {
    stickerId: s.id,
    childId: s.childId,
    chartDate: s.chartDate,
    routineName: s.routineName,
    status: s.status,
    autoAwarded: s.autoAwarded,
    choices: s.status === 'REVOKED' ? [] : s.choices.map(designRef),
    claimed: s.status !== 'UNCLAIMED' && s.designId !== null ? designRef(s.designId) : null,
  }
}

function shuffled<T>(items: T[]): T[] {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** Choices of the latest revoked sticker for this routine and day that still has some (FR-12.5). */
function previousChoices(routineId: number, date: string): number[] {
  const revoked = state.stickers.filter(
    (s) => s.routineId === routineId && s.chartDate === date && s.source === 'ROUTINE' && s.status === 'REVOKED' && s.choices.length > 0,
  )
  return revoked.length > 0 ? [...revoked[revoked.length - 1].choices] : []
}

/**
 * Earns the routine's sticker for `date`: UNCLAIMED with up to 3 choices, or the AVAILABLE fallback.
 * Re-earning after a revoke offers the same choices again (FR-12.5). Only I'm Done! and day settlement call this.
 */
export function earnSticker(
  r: FakeRoutine,
  date: string,
  finishMode: 'TAPPED' | 'AUTO',
  earnedAt: string = nowIso(),
): FakeSticker {
  const reused = previousChoices(r.id, date)
  const choices =
    reused.length > 0
      ? reused
      : shuffled(designPool())
          .slice(0, 3)
          .map((d) => d.id)
  const auto = choices.length === 0
  const now = earnedAt
  const sticker: FakeSticker = {
    id: newId('sticker'),
    childId: r.childId,
    routineId: r.id,
    chartDate: date,
    routineName: r.name,
    routineIconKey: r.iconKey,
    source: 'ROUTINE',
    status: auto ? 'AVAILABLE' : 'UNCLAIMED',
    designId: auto ? fallbackDesign().id : null,
    choices,
    autoAwarded: auto,
    prizeRequestId: null,
    earnedAt: now,
    claimedAt: auto ? now : null,
    finishMode,
  }
  state.stickers.push(sticker)
  return sticker
}

/** The instant a day ends: the start of the next one (TDD 7.12). */
const endOfDayIso = (date: string): string => `${addDays(date, 1)}T00:00:00.000Z`

/**
 * Mirrors DaySettlement (TDD 7.12): a routine still Ready to finish when its day ended is finished for the child.
 * Lazy and per child. `settledThrough` is the watermark, so a parent's later edit of a past day is never auto-finished.
 */
function settleEndedDays(childId: number): void {
  const child = findChild(childId)
  const yesterday = addDays(today(), -1)
  if (child.settledThrough !== null && child.settledThrough >= yesterday) return
  // A child with no watermark has nothing waiting; the first touch just starts the watermark.
  if (child.settledThrough !== null) {
    for (let d = addDays(child.settledThrough, 1); d <= yesterday; d = addDays(d, 1)) {
      for (const r of scheduledRoutines(childId, d)) {
        if (r.upcomingSkips.includes(d) || stickerForRoutineDay(r.id, d)) continue
        if (!r.tasks.every((t) => state.completions.has(doneKey(t.id, d)))) continue
        earnSticker(r, d, 'AUTO', endOfDayIso(d))
      }
    }
  }
  child.settledThrough = yesterday
}

/** Validates a task write and returns its context. */
function taskContext(childId: number, rawDate: string, taskId: number) {
  findChild(childId)
  const date = requireDate(rawDate)
  requireNotFuture(date)
  const routine = state.routines.find((r) => r.childId === childId && r.tasks.some((t) => t.id === taskId))
  if (!routine) throw notFound('Task')
  if (!isScheduled(routine, date) || routine.upcomingSkips.includes(date)) {
    throw conflict('ROUTINE_NOT_SCHEDULED', 'That routine is not scheduled for this day')
  }
  if (date < today() && !state.parentSession) {
    throw conflict('DAY_CHANGED', 'A new day has started', { today: today() })
  }
  settleEndedDays(childId)
  return { routine, date }
}

export function completeTask(childId: number, rawDate: string, taskId: number): TaskToggleResult {
  const { routine, date } = taskContext(childId, rawDate, taskId)
  // Checking the last task never earns anything (FR-7.1): the routine just becomes READY_TO_FINISH.
  if (!stickerForRoutineDay(routine.id, date)) state.completions.add(doneKey(taskId, date))
  return { routine: chartRoutine(routine, date), pick: null, revoked: null }
}

/** I'm Done! (FR-6.8): the only way to earn the sticker besides the day ending. Idempotent, like the backend. */
export function finishRoutine(childId: number, rawDate: string, routineId: number): TaskToggleResult {
  findChild(childId)
  const date = requireDate(rawDate)
  requireNotFuture(date)
  if (date < today() && !state.parentSession) {
    throw conflict('DAY_CHANGED', 'A new day has started', { today: today() })
  }
  settleEndedDays(childId)
  const routine = state.routines.find((r) => r.id === routineId && r.childId === childId)
  if (!routine) throw notFound('Routine')
  if (!isScheduled(routine, date) || routine.upcomingSkips.includes(date)) {
    throw conflict('ROUTINE_NOT_SCHEDULED', 'That routine is not scheduled for this day')
  }
  const existing = stickerForRoutineDay(routine.id, date)
  if (existing) {
    return {
      routine: chartRoutine(routine, date),
      pick: existing.status === 'UNCLAIMED' ? pickDto(existing) : null,
      revoked: null,
    }
  }
  if (!routine.tasks.every((t) => state.completions.has(doneKey(t.id, date)))) {
    throw conflict('ROUTINE_NOT_READY', 'Some tasks in this routine are not done yet')
  }
  const sticker = earnSticker(routine, date, 'TAPPED')
  return { routine: chartRoutine(routine, date), pick: pickDto(sticker), revoked: null }
}

export function uncompleteTask(
  childId: number,
  rawDate: string,
  taskId: number,
  opts: { revokeSticker?: boolean; note?: string | null } = {},
): TaskToggleResult {
  const { routine, date } = taskContext(childId, rawDate, taskId)
  const sticker = stickerForRoutineDay(routine.id, date)
  if (sticker) {
    if (!state.parentSession) {
      throw conflict('ROUTINE_LOCKED', 'This routine already earned a sticker, so it can not be undone')
    }
    if (!opts.revokeSticker) {
      const dto = chartRoutine(routine, date).sticker
      throw conflict('REVOKE_CONFIRMATION_REQUIRED', 'Confirm to remove this sticker', dto ? { sticker: dto } : {})
    }
    return revokeSticker(routine, taskId, date, sticker, opts.note ?? null)
  }
  state.completions.delete(doneKey(taskId, date))
  return { routine: chartRoutine(routine, date), pick: null, revoked: null }
}

export function seedCompletion(taskId: number, date: string): void {
  state.completions.add(doneKey(taskId, date))
}

// ---------------------------------------------------------------------------------------------
// Sticker revocation (parent only; FR-12)

/** Soft delete: the sticker row stays with status REVOKED (TDD 7.11); live reads skip it. */
function revokeSticker(
  routine: FakeRoutine,
  taskId: number,
  date: string,
  sticker: FakeSticker,
  note: string | null,
): TaskToggleResult {
  if (sticker.status === 'USED') throw conflict('STICKER_USED', 'That sticker was already used for a prize')
  const task = routine.tasks.find((t) => t.id === taskId)
  if (!task) throw notFound('Task')
  if (!state.completions.has(doneKey(taskId, date))) {
    return { routine: chartRoutine(routine, date), pick: null, revoked: null }
  }
  const design = sticker.status !== 'UNCLAIMED' && sticker.designId !== null ? designRef(sticker.designId) : null
  let requestId: number | null = null
  let cancelled = false
  if (sticker.status === 'PENDING' && sticker.prizeRequestId !== null) {
    const request = state.prizeRequests.find((r) => r.id === sticker.prizeRequestId)
    if (request) {
      requestId = request.id
      const stillPending = request.stickerIds.some(
        (id) => id !== sticker.id && state.stickers.find((x) => x.id === id)?.status === 'PENDING',
      )
      if (!stillPending) {
        request.status = 'CANCELLED'
        request.cancelledAt = nowIso()
        request.cancelledBy = 'PARENT'
        request.cancelReason = 'ALL_STICKERS_REVOKED'
        cancelled = true
      }
    }
  }
  const revocation: Revocation = {
    stickerId: sticker.id,
    childId: routine.childId,
    chartDate: date,
    routineId: routine.id,
    routineName: routine.name,
    routineIconKey: routine.iconKey,
    taskId,
    taskLabel: task.label,
    fromStatus: sticker.status,
    design,
    prizeRequestId: requestId,
    requestCancelled: cancelled,
    note,
    revokedAt: nowIso(),
  }
  state.revocations.push(revocation)
  state.completions.delete(doneKey(taskId, date))
  sticker.status = 'REVOKED'
  sticker.prizeRequestId = null
  // the choices stay on the revoked sticker so a re-earn can offer them again (FR-12.5)
  return {
    routine: chartRoutine(routine, date),
    pick: null,
    revoked: {
      stickerId: sticker.id,
      fromStatus: revocation.fromStatus,
      prizeRequestId: requestId,
      requestCancelled: cancelled,
    },
  }
}

// ---------------------------------------------------------------------------------------------
// History

export function getHistory(childId: number, from: string | undefined, to: string | undefined): History {
  findChild(childId)
  const f = requireDate(from, 'from')
  const t = requireDate(to, 'to')
  if (f > t) throw invalid([{ field: 'from', message: 'must not be after "to"' }])
  requireNotFuture(t)
  settleEndedDays(childId)
  const days: HistoryDay[] = []
  for (let d = f, n = 0; d <= t; d = addDays(d, 1), n++) {
    if (n >= 62) throw invalid([{ field: 'to', message: 'the range can cover at most 62 days' }])
    days.push({
      date: d,
      routines: scheduledRoutines(childId, d).map((r) => {
        const c = chartRoutine(r, d)
        return {
          routineId: c.routineId,
          name: c.name,
          iconKey: c.iconKey,
          state: c.state,
          doneCount: c.doneCount,
          taskCount: c.taskCount,
          stickerId: c.sticker ? c.sticker.stickerId : null,
          autoFinished: stickerForRoutineDay(r.id, d)?.finishMode === 'AUTO',
        }
      }),
      revocations: state.revocations
        .filter((r) => r.childId === childId && r.chartDate === d)
        .sort((a, b) => a.revokedAt.localeCompare(b.revokedAt) || a.stickerId - b.stickerId)
        .map((r) => ({ ...r })),
    })
  }
  return { childId, from: f, to: t, days }
}

// ---------------------------------------------------------------------------------------------
// Stickers

export function seedSticker(input: Partial<FakeSticker> & Pick<FakeSticker, 'childId' | 'chartDate'>): FakeSticker {
  const status = input.status ?? 'AVAILABLE'
  const sticker: FakeSticker = {
    id: newId('sticker'),
    routineId: null,
    routineName: null,
    routineIconKey: null,
    source: 'ROUTINE',
    status,
    designId: status === 'UNCLAIMED' ? null : (designPool()[0]?.id ?? fallbackDesign().id),
    choices: [],
    autoAwarded: false,
    prizeRequestId: null,
    earnedAt: noonIso(input.chartDate),
    claimedAt: status === 'UNCLAIMED' ? null : noonIso(input.chartDate),
    finishMode: null,
    ...input,
  }
  state.stickers.push(sticker)
  return sticker
}

export function getStickerPick(stickerId: number): StickerPick {
  return pickDto(findSticker(stickerId))
}

function bookSticker(s: FakeSticker): BookSticker {
  if (s.designId === null) throw new Error('unclaimed sticker has no design')
  return {
    stickerId: s.id,
    childId: s.childId,
    status: s.status,
    source: s.source,
    chartDate: s.chartDate,
    routineName: s.routineName,
    routineIconKey: s.routineIconKey,
    design: designRef(s.designId),
    earnedAt: s.earnedAt,
    claimedAt: s.claimedAt,
    prizeRequestId: s.prizeRequestId,
  }
}

export function claimStickerPick(stickerId: number, body: unknown): BookSticker {
  const sticker = findSticker(stickerId)
  const c = new Check(asObj(body))
  const designId = c.int('designId', 1)
  c.done()
  if (sticker.status === 'REVOKED') throw conflict('STICKER_REVOKED', 'That sticker was removed by a parent')
  if (sticker.status !== 'UNCLAIMED') {
    if (sticker.designId === designId) return bookSticker(sticker)
    throw conflict('ALREADY_CLAIMED', 'This sticker was already picked')
  }
  if (!sticker.choices.includes(designId)) {
    throw new FakeApiError(422, 'CHOICE_NOT_OFFERED', 'That design was not one of the choices')
  }
  sticker.designId = designId
  sticker.status = 'AVAILABLE'
  sticker.claimedAt = nowIso()
  return bookSticker(sticker)
}

function paginate<T>(items: T[], cursor: string | null | undefined, limit: number | null | undefined) {
  const size = Math.min(100, Math.max(1, Number.isFinite(limit) && limit ? Math.floor(limit) : 50))
  const parsed = cursor ? Number(cursor) : 0
  const start = Number.isInteger(parsed) && parsed > 0 ? parsed : 0
  const end = start + size
  return { items: items.slice(start, end), nextCursor: end < items.length ? String(end) : null }
}

export function getStickerBook(
  childId: number,
  query: { status?: string | null; cursor?: string | null; limit?: number | null } = {},
): StickerBookPage {
  findChild(childId)
  const status = query.status ?? null
  if (status !== null && status !== 'AVAILABLE' && status !== 'PENDING' && status !== 'USED') {
    throw invalid([{ field: 'status', message: 'must be AVAILABLE, PENDING or USED' }])
  }
  const mine = state.stickers.filter((s) => s.childId === childId && s.status !== 'REVOKED')
  const count = (st: StickerStatus) => mine.filter((s) => s.status === st).length
  const counts: StickerCounts = {
    available: count('AVAILABLE'),
    pending: count('PENDING'),
    used: count('USED'),
    totalEarned: count('AVAILABLE') + count('PENDING') + count('USED'),
    unclaimed: count('UNCLAIMED'),
  }
  const visible = mine
    .filter((s) => s.status !== 'UNCLAIMED' && (status === null || s.status === status))
    .sort((a, b) => b.earnedAt.localeCompare(a.earnedAt) || b.id - a.id)
  const page = paginate(visible, query.cursor, query.limit)
  return { counts, items: page.items.map(bookSticker), nextCursor: page.nextCursor }
}

export function getStickerDetail(stickerId: number): StickerDetail {
  const s = findSticker(stickerId)
  const request = s.prizeRequestId !== null ? state.prizeRequests.find((r) => r.id === s.prizeRequestId) : undefined
  return {
    stickerId: s.id,
    childId: s.childId,
    status: s.status,
    source: s.source,
    chartDate: s.chartDate,
    routineName: s.routineName,
    routineIconKey: s.routineIconKey,
    design: s.designId !== null ? designRef(s.designId) : null,
    earnedAt: s.earnedAt,
    claimedAt: s.claimedAt,
    prize:
      s.status === 'USED' && request && request.status === 'COMPLETED' && request.completedAt
        ? {
            prizeRequestId: request.id,
            prizeText: request.prizeText ?? '',
            note: request.note,
            completedAt: request.completedAt,
          }
        : null,
  }
}

// ---------------------------------------------------------------------------------------------
// Prize requests

function prizeRequestDto(r: FakePrizeRequest): PrizeRequest {
  const child = state.children.find((c) => c.id === r.childId)
  const stickers = r.stickerIds
    .map((id) => state.stickers.find((s) => s.id === id))
    .filter((s): s is FakeSticker => s !== undefined && s.designId !== null)
    .map((s) => ({
      stickerId: s.id,
      chartDate: s.chartDate,
      routineName: s.routineName,
      design: designRef(s.designId as number),
      revoked: s.status === 'REVOKED',
    }))
  return {
    id: r.id,
    childId: r.childId,
    childName: child?.name ?? '',
    status: r.status,
    createdBy: r.createdBy,
    stickerCount: stickers.filter((x) => !x.revoked).length,
    stickers,
    prizeText: r.prizeText,
    note: r.note,
    createdAt: r.createdAt,
    completedAt: r.completedAt,
    cancelledAt: r.cancelledAt,
    cancelledBy: r.cancelledBy,
    cancelReason: r.cancelReason,
    reversedAt: r.reversedAt,
  }
}

export function seedPrizeRequest(input: {
  childId: number
  stickerIds: number[]
  status: PrizeRequestStatus
  createdBy?: Actor
  prizeText?: string | null
  note?: string | null
  createdAt?: string
}): FakePrizeRequest {
  const createdAt = input.createdAt ?? nowIso()
  const request: FakePrizeRequest = {
    id: newId('request'),
    childId: input.childId,
    status: input.status,
    createdBy: input.createdBy ?? 'CHILD',
    stickerIds: input.stickerIds,
    prizeText: input.prizeText ?? null,
    note: input.note ?? null,
    createdAt,
    completedAt: input.status === 'COMPLETED' ? createdAt : null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    reversedAt: null,
  }
  state.prizeRequests.push(request)
  for (const id of input.stickerIds) {
    const s = state.stickers.find((x) => x.id === id)
    if (s) {
      s.prizeRequestId = request.id
      s.status = input.status === 'COMPLETED' ? 'USED' : 'PENDING'
    }
  }
  return request
}

export function getPendingPrizeRequest(childId: number): PendingPrizeRequest {
  findChild(childId)
  const r = state.prizeRequests.find((x) => x.childId === childId && x.status === 'PENDING')
  return { request: r ? prizeRequestDto(r) : null }
}

export function createPrizeRequest(childId: number, body: unknown): PrizeRequest {
  findChild(childId)
  const raw = asObj(body).stickerIds
  if (!Array.isArray(raw) || raw.length === 0 || !raw.every((x) => typeof x === 'number' && Number.isInteger(x))) {
    throw invalid([{ field: 'stickerIds', message: 'must be a non-empty list of sticker ids' }])
  }
  const ids = [...new Set(raw as number[])]
  if (state.prizeRequests.some((r) => r.childId === childId && r.status === 'PENDING')) {
    throw conflict('PENDING_REQUEST_EXISTS', 'There is already a pending prize request')
  }
  const stickers = ids.map((id) => state.stickers.find((s) => s.id === id))
  if (stickers.some((s) => !s || s.childId !== childId || s.status !== 'AVAILABLE')) {
    throw conflict('STICKER_NOT_AVAILABLE', 'Some of those stickers are not available')
  }
  const request = seedPrizeRequest({ childId, stickerIds: ids, status: 'PENDING', createdBy: sessionActor() })
  return prizeRequestDto(request)
}

export function cancelPrizeRequest(requestId: number): PrizeRequest {
  const r = findPrizeRequest(requestId)
  if (r.status !== 'PENDING') throw conflict('REQUEST_NOT_PENDING', 'Only a pending request can be cancelled')
  r.status = 'CANCELLED'
  r.cancelledAt = nowIso()
  r.cancelledBy = sessionActor()
  r.cancelReason = 'CANCELLED'
  for (const id of r.stickerIds) {
    const s = state.stickers.find((x) => x.id === id)
    if (s && s.status === 'PENDING') {
      s.status = 'AVAILABLE'
      s.prizeRequestId = null
    }
  }
  return prizeRequestDto(r)
}

function prizeText(o: Obj): string {
  const c = new Check(o)
  const text = c.str('prizeText', 200)
  c.done()
  return text
}

export function completePrizeRequest(requestId: number, body: unknown): PrizeRequest {
  const o = asObj(body)
  const text = prizeText(o)
  const note = optionalText(o, 'note')
  const r = findPrizeRequest(requestId)
  if (r.status !== 'PENDING') throw conflict('REQUEST_NOT_PENDING', 'Only a pending request can be completed')
  r.status = 'COMPLETED'
  r.prizeText = text
  r.note = note
  r.completedAt = nowIso()
  for (const id of r.stickerIds) {
    const s = state.stickers.find((x) => x.id === id)
    if (s && s.status === 'PENDING') s.status = 'USED'
  }
  return prizeRequestDto(r)
}

export function editPrizeRequest(requestId: number, body: unknown): PrizeRequest {
  const o = asObj(body)
  const text = prizeText(o)
  const note = optionalText(o, 'note')
  const r = findPrizeRequest(requestId)
  if (r.status !== 'COMPLETED') throw conflict('REQUEST_NOT_COMPLETED', 'Only a completed request can be edited')
  r.prizeText = text
  r.note = note
  return prizeRequestDto(r)
}

export function listPrizeRequests(query: {
  /** Repeatable query param: a single value or a list. Empty/absent = all statuses. */
  status?: string | string[] | null
  childId?: number | null
  cursor?: string | null
  limit?: number | null
}): PrizeRequestPage {
  const statuses: string[] = ['PENDING', 'COMPLETED', 'CANCELLED', 'REVERSED']
  const wanted = (Array.isArray(query.status) ? query.status : [query.status ?? '']).filter((v) => v !== '')
  if (wanted.some((v) => !statuses.includes(v))) {
    throw invalid([{ field: 'status', message: `must be one of ${statuses.join(', ')}` }])
  }
  const items = state.prizeRequests
    .filter((r) => wanted.length === 0 || wanted.includes(r.status))
    .filter((r) => query.childId === null || query.childId === undefined || r.childId === query.childId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id)
  const page = paginate(items, query.cursor, query.limit)
  return { items: page.items.map(prizeRequestDto), nextCursor: page.nextCursor }
}

// ---------------------------------------------------------------------------------------------
// Library

function designDto(d: FakeDesign): Design {
  const category = d.categoryId !== null ? state.categories.find((c) => c.id === d.categoryId) : undefined
  return {
    id: d.id,
    name: d.name,
    artworkKey: d.artworkKey,
    categoryId: d.categoryId,
    categoryName: category?.name ?? null,
    status: d.status,
    inUse: state.stickers.some((s) => s.designId === d.id || s.choices.includes(d.id)),
    createdAt: d.createdAt,
  }
}

/** Fallback design is hidden: every library lookup treats it as missing. */
function findLibraryDesign(id: number): FakeDesign {
  const d = findDesign(id)
  if (d.isFallback) throw notFound('Design')
  return d
}

export function listDesigns(query: { q?: string | null; status?: string | null; categoryId?: number | null }): Library {
  if (query.status && query.status !== 'ACTIVE' && query.status !== 'RETIRED') {
    throw invalid([{ field: 'status', message: 'must be ACTIVE or RETIRED' }])
  }
  const q = query.q?.trim().toLowerCase()
  const designs = state.designs
    .filter((d) => !d.isFallback)
    .filter((d) => !q || d.name.toLowerCase().includes(q))
    .filter((d) => !query.status || d.status === query.status)
    .filter((d) => query.categoryId === null || query.categoryId === undefined || d.categoryId === query.categoryId)
    .sort((a, b) => a.id - b.id)
    .map(designDto)
  return { activeCount: designPool().length, designs }
}

function designInput(body: unknown): { name: string; artworkKey: string; categoryId: number | null } {
  const o = asObj(body)
  const c = new Check(o)
  const name = c.str('name', 40)
  const artworkKey = c.str('artworkKey', 64)
  c.done()
  const categoryId = o.categoryId
  if (categoryId === null || categoryId === undefined) return { name, artworkKey, categoryId: null }
  if (typeof categoryId !== 'number' || !state.categories.some((x) => x.id === categoryId)) {
    throw invalid([{ field: 'categoryId', message: 'must be an existing category or null' }])
  }
  return { name, artworkKey, categoryId }
}

export function createDesign(body: unknown): Design {
  const input = designInput(body)
  const d: FakeDesign = {
    id: newId('design'),
    ...input,
    status: 'ACTIVE',
    isFallback: false,
    createdAt: nowIso(),
  }
  state.designs.push(d)
  return designDto(d)
}

export function updateDesign(designId: number, body: unknown): Design {
  const d = findLibraryDesign(designId)
  Object.assign(d, designInput(body))
  return designDto(d)
}

export function setDesignStatus(designId: number, body: unknown): Design {
  const d = findLibraryDesign(designId)
  const status = asObj(body).status
  if (status !== 'ACTIVE' && status !== 'RETIRED') {
    throw invalid([{ field: 'status', message: 'must be ACTIVE or RETIRED' }])
  }
  d.status = status
  return designDto(d)
}

export function deleteDesign(designId: number): void {
  const d = findLibraryDesign(designId)
  if (designDto(d).inUse) throw conflict('DESIGN_IN_USE', 'This design is already in the Sticker Book')
  state.designs = state.designs.filter((x) => x.id !== designId)
}

function categoryDto(c: FakeCategory): Category {
  return {
    id: c.id,
    name: c.name,
    enabled: c.enabled,
    position: c.position,
    designCount: state.designs.filter((d) => !d.isFallback && d.categoryId === c.id).length,
  }
}

function categoryInput(body: unknown): { name: string; enabled: boolean } {
  const o = asObj(body)
  const c = new Check(o)
  const name = c.str('name', 40)
  if (o.enabled !== undefined && typeof o.enabled !== 'boolean') {
    c.errors.push({ field: 'enabled', message: 'must be true or false' })
  }
  c.done()
  return { name, enabled: o.enabled !== false }
}

export const listCategories = (): Category[] =>
  [...state.categories].sort((a, b) => a.position - b.position).map(categoryDto)

export function createCategory(body: unknown): Category {
  const input = categoryInput(body)
  const c: FakeCategory = {
    id: newId('category'),
    ...input,
    position: state.categories.reduce((m, x) => Math.max(m, x.position), 0) + 1,
  }
  state.categories.push(c)
  return categoryDto(c)
}

function findCategory(id: number): FakeCategory {
  const c = state.categories.find((x) => x.id === id)
  if (!c) throw notFound('Category')
  return c
}

export function updateCategory(categoryId: number, body: unknown): Category {
  const c = findCategory(categoryId)
  Object.assign(c, categoryInput(body))
  return categoryDto(c)
}

/** Simplification: designs of a deleted category become uncategorised. */
export function deleteCategory(categoryId: number): void {
  findCategory(categoryId)
  state.categories = state.categories.filter((c) => c.id !== categoryId)
  for (const d of state.designs) if (d.categoryId === categoryId) d.categoryId = null
}
