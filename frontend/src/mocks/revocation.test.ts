import { describe, expect, it } from 'vitest'
import { getFakeState, resetFakeApi, setFakeParentSession } from './fakeApi'
import * as fake from './fakeState'
import { FakeApiError } from './fakeState'

const JANE = 1
const BASE = 'http://localhost'

function code(fn: () => unknown): string {
  try {
    fn()
  } catch (e) {
    if (e instanceof FakeApiError) return `${e.status} ${e.code}`
    throw e
  }
  return 'ok'
}

/** A Jane sticker with the given status, plus the routine/task/date it belongs to. */
function target(status: 'AVAILABLE' | 'PENDING' | 'USED' | 'UNCLAIMED', from = getFakeState().stickers) {
  const s = from.find((x) => x.childId === JANE && x.status === status && x.routineId !== null)
  if (!s || s.routineId === null) throw new Error(`no ${status} sticker`)
  const routine = getFakeState().routines.find((r) => r.id === s.routineId)
  if (!routine) throw new Error('no routine')
  return { sticker: s, routine, date: s.chartDate, taskId: routine.tasks[1].id }
}

const revoke = (date: string, taskId: number) => fake.uncompleteTask(JANE, date, taskId, { revokeSticker: true })

describe('sticker revocation (interim fake)', () => {
  it('revokes an AVAILABLE past-day sticker', () => {
    resetFakeApi()
    setFakeParentSession(true)
    const t = target('AVAILABLE')
    const before = fake.getStickerBook(JANE).counts
    const res = revoke(t.date, t.taskId)
    expect(res.routine.state).toBe('MISSED')
    expect(res.routine.sticker).toBeNull()
    expect(res.routine.tasks.filter((x) => !x.done)).toHaveLength(1)
    expect(res.revoked).toEqual({
      stickerId: t.sticker.id,
      fromStatus: 'AVAILABLE',
      prizeRequestId: null,
      requestCancelled: false,
    })
    expect(fake.getStickerBook(JANE).counts.available).toBe(before.available - 1)
    const day = fake.getHistory(JANE, t.date, t.date).days[0]
    expect(day.revocations.map((r) => r.stickerId)).toEqual([t.sticker.id])
    expect(day.revocations[0]).toMatchObject({ fromStatus: 'AVAILABLE', taskId: t.taskId, routineName: t.routine.name })
    expect(day.revocations[0].design).not.toBeNull()
  })

  it('a parent without revokeSticker gets REVOKE_CONFIRMATION_REQUIRED and nothing changes', () => {
    resetFakeApi()
    setFakeParentSession(true)
    const t = target('AVAILABLE')
    try {
      fake.uncompleteTask(JANE, t.date, t.taskId)
      throw new Error('expected a conflict')
    } catch (e) {
      if (!(e instanceof FakeApiError)) throw e
      expect(`${e.status} ${e.code}`).toBe('409 REVOKE_CONFIRMATION_REQUIRED')
      expect(e.extras.sticker).toMatchObject({ stickerId: t.sticker.id, status: 'AVAILABLE', revocable: true })
    }
    expect(getFakeState().stickers.some((s) => s.id === t.sticker.id)).toBe(true)
  })

  it('parent chart stickers carry prizeRequestId and revocable; child ones do not', () => {
    resetFakeApi('pending-request')
    const t = target('PENDING')
    setFakeParentSession(false)
    expect(fake.getDailyChart(JANE, t.date).routines.find((r) => r.routineId === t.routine.id)?.sticker).toMatchObject({
      prizeRequestId: null,
      revocable: null,
    })
    setFakeParentSession(true)
    expect(fake.getDailyChart(JANE, t.date).routines.find((r) => r.routineId === t.routine.id)?.sticker).toMatchObject({
      prizeRequestId: t.sticker.prizeRequestId,
      revocable: true,
    })
  })

  it('re-earning after a revoke gives a new sticker with new choices', () => {
    resetFakeApi('one-task-left')
    setFakeParentSession(true)
    const routine = getFakeState().routines.find((r) => r.childId === JANE && r.name === 'Morning Routine')
    if (!routine) throw new Error('missing routine')
    const date = fake.today()
    fake.completeTask(JANE, date, routine.tasks[3].id)
    const first = fake.finishRoutine(JANE, date, routine.id)
    const oldId = first.pick?.stickerId
    expect(first.pick?.status).toBe('UNCLAIMED')
    const res = revoke(date, routine.tasks[3].id)
    expect(res.routine.state).toBe('IN_PROGRESS')
    expect(res.revoked?.fromStatus).toBe('UNCLAIMED')
    expect(fake.getDailyChart(JANE, date).unclaimedFromEarlierDays.some((u) => u.stickerId === oldId)).toBe(false)
    // the last check only makes the routine Ready to finish. I'm Done! earns the new sticker.
    expect(fake.completeTask(JANE, date, routine.tasks[3].id).routine.state).toBe('READY_TO_FINISH')
    const again = fake.finishRoutine(JANE, date, routine.id)
    expect(again.pick?.stickerId).not.toBe(oldId)
    expect(again.routine.state).toBe('AWAITING_PICK')
  })

  it('PENDING stickers: request stays pending with 1 left, then is cancelled for ALL_STICKERS_REVOKED', () => {
    resetFakeApi('pending-request')
    setFakeParentSession(true)
    const request = getFakeState().prizeRequests.find((r) => r.status === 'PENDING')
    if (!request) throw new Error('no request')
    expect(request.stickerIds).toHaveLength(2)
    const stickers = request.stickerIds.map((id) => getFakeState().stickers.find((s) => s.id === id))
    const ctx = (i: number) => {
      const s = stickers[i]
      const routine = getFakeState().routines.find((r) => r.id === s?.routineId)
      if (!s || !routine) throw new Error('bad sticker')
      return { date: s.chartDate, taskId: routine.tasks[0].id }
    }
    const a = ctx(0)
    const b = ctx(1)
    const first = revoke(a.date, a.taskId)
    expect(first.revoked).toMatchObject({ fromStatus: 'PENDING', prizeRequestId: request.id, requestCancelled: false })
    expect(fake.getPendingPrizeRequest(JANE).request).toMatchObject({ status: 'PENDING', stickerCount: 1 })
    const second = revoke(b.date, b.taskId)
    expect(second.revoked?.requestCancelled).toBe(true)
    expect(request).toMatchObject({ status: 'CANCELLED', cancelledBy: 'PARENT', cancelReason: 'ALL_STICKERS_REVOKED' })
    expect(fake.getBootstrap().pendingPrizeRequestCount).toBe(0)
  })

  it('USED stickers cannot be revoked', () => {
    resetFakeApi()
    setFakeParentSession(true)
    const t = target('USED')
    expect(code(() => revoke(t.date, t.taskId))).toBe('409 STICKER_USED')
    expect(getFakeState().stickers.some((s) => s.id === t.sticker.id)).toBe(true)
  })

  it('task writes on an unscheduled (skipped) routine answer 409 ROUTINE_NOT_SCHEDULED', () => {
    resetFakeApi()
    setFakeParentSession(true)
    const t = target('AVAILABLE')
    t.routine.upcomingSkips.push(t.date)
    expect(code(() => fake.completeTask(JANE, t.date, t.taskId))).toBe('409 ROUTINE_NOT_SCHEDULED')
    expect(code(() => fake.uncompleteTask(JANE, t.date, t.taskId))).toBe('409 ROUTINE_NOT_SCHEDULED')
    t.routine.upcomingSkips = []
  })

  it('validation order', () => {
    resetFakeApi()
    setFakeParentSession(true)
    const t = target('AVAILABLE')
    expect(code(() => revoke(fake.addDays(fake.today(), 1), t.taskId))).toBe('422 FUTURE_DATE')
    expect(code(() => revoke(t.date, 99999))).toBe('404 NOT_FOUND')
    expect(code(() => fake.uncompleteTask(2, t.date, t.taskId, { revokeSticker: true }))).toBe('404 NOT_FOUND')
  })

  it('child DELETE on an earned routine today stays ROUTINE_LOCKED', () => {
    resetFakeApi('pick-waiting')
    setFakeParentSession(false)
    const routine = getFakeState().routines.find((r) => r.childId === JANE && r.name === 'Morning Routine')
    if (!routine) throw new Error('missing routine')
    expect(code(() => fake.uncompleteTask(JANE, fake.today(), routine.tasks[0].id))).toBe('409 ROUTINE_LOCKED')
  })
})

describe('revocation over HTTP', () => {
  const path = (date: string, taskId: number, qs = '') =>
    `${BASE}/api/children/${JANE}/days/${date}/tasks/${taskId}${qs}`

  it('answers 409 REVOKE_CONFIRMATION_REQUIRED with the sticker, then revokes with the flag', async () => {
    resetFakeApi()
    const t = target('AVAILABLE')
    setFakeParentSession(true)
    const headers = { 'X-Sticker-Bank': '1' }
    const asked = await fetch(path(t.date, t.taskId), { method: 'DELETE', headers })
    expect(asked.status).toBe(409)
    const problem = (await asked.json()) as { code: string; sticker: { stickerId: number } }
    expect(problem.code).toBe('REVOKE_CONFIRMATION_REQUIRED')
    expect(problem.sticker.stickerId).toBe(t.sticker.id)
    const ok = await fetch(path(t.date, t.taskId, '?revokeSticker=true'), {
      method: 'DELETE',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: 'Oops' }),
    })
    expect(ok.status).toBe(200)
    const body = (await ok.json()) as { revoked: { stickerId: number }; routine: { state: string } }
    expect(body.revoked.stickerId).toBe(t.sticker.id)
    expect(body.routine.state).toBe('MISSED')
    expect(fake.getHistory(JANE, t.date, t.date).days[0].revocations[0].note).toBe('Oops')
  })

  it('a child DELETE on an earned routine answers 409 ROUTINE_LOCKED', async () => {
    resetFakeApi('pick-waiting')
    setFakeParentSession(false)
    const routine = getFakeState().routines.find((r) => r.childId === JANE && r.name === 'Morning Routine')
    if (!routine) throw new Error('missing routine')
    const res = await fetch(path(fake.today(), routine.tasks[0].id), { method: 'DELETE', headers: { 'X-Sticker-Bank': '1' } })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { code: string }).code).toBe('ROUTINE_LOCKED')
  })
})

describe('soft-delete revocation semantics', () => {
  const stickerRow = (id: number) => getFakeState().stickers.find((s) => s.id === id)

  it('keeps a REVOKED row; claim, pick, book and library reflect it', () => {
    resetFakeApi()
    setFakeParentSession(true)
    const t = target('AVAILABLE')
    const designId = t.sticker.designId as number
    const before = fake.getStickerBook(JANE)
    revoke(t.date, t.taskId)
    expect(stickerRow(t.sticker.id)?.status).toBe('REVOKED')
    const book = fake.getStickerBook(JANE)
    expect(book.counts.totalEarned).toBe(before.counts.totalEarned - 1)
    expect(book.items.some((i) => i.stickerId === t.sticker.id)).toBe(false)
    expect(fake.getStickerPick(t.sticker.id)).toMatchObject({ status: 'REVOKED', choices: [] })
    expect(code(() => fake.claimStickerPick(t.sticker.id, { designId }))).toBe('409 STICKER_REVOKED')
    const design = fake.listDesigns({}).designs.find((d) => d.id === designId)
    expect(design?.inUse).toBe(true)
    // Idempotent double revoke.
    const again = revoke(t.date, t.taskId)
    expect(again.revoked).toBeNull()
    expect(fake.getHistory(JANE, t.date, t.date).days[0].revocations).toHaveLength(1)
  })

  it('UNCLAIMED: discards choices and clears the tray; re-earning coexists with the REVOKED row', () => {
    resetFakeApi('pick-waiting')
    setFakeParentSession(true)
    const routine = getFakeState().routines.find((r) => r.childId === JANE && r.name === 'Morning Routine')
    if (!routine) throw new Error('missing routine')
    const date = fake.today()
    const chart = fake.getDailyChart(JANE, date).routines.find((r) => r.routineId === routine.id)
    const oldId = chart?.sticker?.stickerId as number
    expect(chart?.state).toBe('AWAITING_PICK')
    const res = revoke(date, routine.tasks[0].id)
    expect(res.revoked).toMatchObject({ stickerId: oldId, fromStatus: 'UNCLAIMED' })
    expect(res.routine.state).toBe('IN_PROGRESS')
    expect(stickerRow(oldId)?.choices).toEqual([])
    expect(fake.completeTask(JANE, date, routine.tasks[0].id).routine.state).toBe('READY_TO_FINISH')
    const again = fake.finishRoutine(JANE, date, routine.id)
    expect(again.pick?.stickerId).not.toBe(oldId)
    expect(stickerRow(oldId)?.status).toBe('REVOKED')
    expect(getFakeState().stickers.filter((s) => s.routineId === routine.id && s.chartDate === date && s.status !== 'REVOKED')).toHaveLength(1)
  })

  it('PENDING request lists revoked items and excludes them from stickerCount; complete only uses PENDING', () => {
    resetFakeApi('pending-request')
    setFakeParentSession(true)
    const request = getFakeState().prizeRequests.find((r) => r.status === 'PENDING')
    if (!request) throw new Error('no request')
    const s = stickerRow(request.stickerIds[0])
    const routine = getFakeState().routines.find((r) => r.id === s?.routineId)
    if (!s || !routine) throw new Error('bad')
    revoke(s.chartDate, routine.tasks[0].id)
    expect(s.prizeRequestId).toBeNull()
    const dto = fake.getPendingPrizeRequest(JANE).request
    expect(dto?.stickerCount).toBe(1)
    expect(dto?.stickers).toHaveLength(2)
    expect(dto?.stickers.find((x) => x.stickerId === s.id)?.revoked).toBe(true)
    const done = fake.completePrizeRequest(request.id, { prizeText: 'Test prize' })
    expect(done.stickerCount).toBe(1)
    expect(stickerRow(s.id)?.status).toBe('REVOKED')
    expect(getFakeState().stickers.filter((x) => request.stickerIds.includes(x.id) && x.status === 'USED')).toHaveLength(1)
  })

  it('a normal cancel reports cancelReason CANCELLED', () => {
    resetFakeApi('pending-request')
    setFakeParentSession(true)
    const request = getFakeState().prizeRequests.find((r) => r.status === 'PENDING')
    if (!request) throw new Error('no request')
    expect(fake.cancelPrizeRequest(request.id).cancelReason).toBe('CANCELLED')
  })
})
