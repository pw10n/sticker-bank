import { describe, expect, it } from 'vitest'
import type { Bootstrap, ProblemDetail } from '../api/types'
import { isScenarioName, resetFakeApi, setFakeParentSession, setFakeToday, getFakeState, type ScenarioName } from './fakeApi'
import * as fake from './fakeState'
import { FakeApiError } from './fakeState'

const JANE = 1
const JOHN = 2

function code(fn: () => unknown): string {
  try {
    fn()
  } catch (e) {
    if (e instanceof FakeApiError) return `${e.status} ${e.code}`
    throw e
  }
  return 'ok'
}

function janeMorning() {
  const r = getFakeState().routines.find((x) => x.childId === JANE && x.name === 'Morning Routine')
  if (!r) throw new Error('missing routine')
  return r
}

/** Checks Jane's last two Morning tasks. The routine is then Ready to finish, with no sticker yet (FR-6.6). */
function checkJaneMorning() {
  const r = janeMorning()
  fake.completeTask(JANE, fake.today(), r.tasks[2].id)
  return fake.completeTask(JANE, fake.today(), r.tasks[3].id)
}

/** Checks the tasks and taps I'm Done!, which is what earns the sticker (FR-6.8). */
function finishJaneMorning() {
  checkJaneMorning()
  return fake.finishRoutine(JANE, fake.today(), janeMorning().id)
}

describe('fake state rules', () => {
  it('builds every scenario', () => {
    for (const name of [
      'default',
      'fresh-install',
      'one-task-left',
      'ready-to-finish',
      'pick-waiting',
      'auto-finished',
      'empty-library',
      'pending-request',
      'offline',
    ] as ScenarioName[]) {
      expect(() => resetFakeApi(name)).not.toThrow()
      expect(isScenarioName(name)).toBe(true)
    }
    resetFakeApi('fresh-install')
    expect(fake.getBootstrap().setupRequired).toBe(true)
    expect(fake.getBootstrap().children).toEqual([])
  })

  it('default scenario matches the spec', () => {
    resetFakeApi()
    const chart = fake.getDailyChart(JANE, fake.today())
    expect(chart.routines.map((r) => r.name)).toEqual(['Morning Routine', 'Bedtime'])
    expect(chart.routines[0]).toMatchObject({ doneCount: 2, taskCount: 4, state: 'IN_PROGRESS' })
    expect(fake.getStickerBook(JANE).counts.used).toBe(3)
    expect(fake.getStickerBook(JANE).counts.available).toBeGreaterThan(2)
    const john = fake.getDailyChart(JOHN, fake.today())
    expect(john.unclaimedFromEarlierDays).toHaveLength(1)
    expect(fake.getStickerPick(john.unclaimedFromEarlierDays[0].stickerId).choices).toHaveLength(3)
  })

  it('I\'m Done! earns a pick with 3 distinct pool designs', () => {
    resetFakeApi()
    const res = finishJaneMorning()
    expect(res.routine.state).toBe('AWAITING_PICK')
    expect(res.pick?.status).toBe('UNCLAIMED')
    const ids = res.pick?.choices.map((c) => c.designId) ?? []
    expect(new Set(ids).size).toBe(3)
    const fallback = getFakeState().designs.find((d) => d.isFallback)
    expect(ids).not.toContain(fallback?.id)
    // saved choices are never regenerated
    expect(fake.getStickerPick(res.pick?.stickerId ?? 0).choices).toEqual(res.pick?.choices)
  })

  it('claim rules', () => {
    resetFakeApi('pick-waiting')
    const sticker = getFakeState().stickers.find((s) => s.status === 'UNCLAIMED' && s.childId === JANE)
    if (!sticker) throw new Error('no pick')
    const [a, b] = sticker.choices
    const outside = getFakeState().designs.find((d) => !sticker.choices.includes(d.id))?.id ?? 0
    expect(code(() => fake.claimStickerPick(sticker.id, { designId: outside }))).toBe('422 CHOICE_NOT_OFFERED')
    expect(fake.claimStickerPick(sticker.id, { designId: a }).status).toBe('AVAILABLE')
    expect(fake.claimStickerPick(sticker.id, { designId: a }).design.designId).toBe(a)
    expect(code(() => fake.claimStickerPick(sticker.id, { designId: b }))).toBe('409 ALREADY_CLAIMED')
  })

  it('undo after earning is ROUTINE_LOCKED', () => {
    resetFakeApi()
    finishJaneMorning()
    const r = janeMorning()
    expect(code(() => fake.uncompleteTask(JANE, fake.today(), r.tasks[0].id))).toBe('409 ROUTINE_LOCKED')
    expect(code(() => fake.addRoutineSkip(r.id, fake.today()))).toBe('409 ROUTINE_LOCKED')
  })

  it('child writes to a past day are DAY_CHANGED; parents may fix them; future is FUTURE_DATE', () => {
    resetFakeApi()
    const r = janeMorning()
    const yesterday = fake.addDays(fake.today(), -1)
    expect(code(() => fake.completeTask(JANE, yesterday, r.tasks[0].id))).toBe('409 DAY_CHANGED')
    setFakeParentSession(true)
    const done = fake.uncompleteTask(JANE, fake.addDays(fake.today(), -3), r.tasks[0].id)
    expect(done.routine.taskCount).toBe(4)
    expect(code(() => fake.getDailyChart(JANE, fake.addDays(fake.today(), 1)))).toBe('422 FUTURE_DATE')
  })

  it('allows one pending request per child and only AVAILABLE stickers', () => {
    resetFakeApi()
    const mine = getFakeState().stickers.filter((s) => s.childId === JANE && s.status === 'AVAILABLE')
    const req = fake.createPrizeRequest(JANE, { stickerIds: [mine[0].id] })
    expect(req.status).toBe('PENDING')
    expect(req.createdBy).toBe('CHILD')
    expect(code(() => fake.createPrizeRequest(JANE, { stickerIds: [mine[1].id] }))).toBe('409 PENDING_REQUEST_EXISTS')
    fake.cancelPrizeRequest(req.id)
    expect(code(() => fake.cancelPrizeRequest(req.id))).toBe('409 REQUEST_NOT_PENDING')
    const used = getFakeState().stickers.find((s) => s.status === 'USED')
    expect(code(() => fake.createPrizeRequest(JANE, { stickerIds: [used?.id ?? 0] }))).toBe('409 STICKER_NOT_AVAILABLE')
    const again = fake.createPrizeRequest(JANE, { stickerIds: [mine[0].id] })
    const done = fake.completePrizeRequest(again.id, { prizeText: 'Ice cream' })
    expect(done.status).toBe('COMPLETED')
    expect(fake.getStickerDetail(mine[0].id).prize?.prizeText).toBe('Ice cream')
    expect(code(() => fake.editPrizeRequest(req.id, { prizeText: 'x' }))).toBe('409 REQUEST_NOT_COMPLETED')
  })

  it('filters prize requests by a repeatable status set (empty = all)', () => {
    resetFakeApi()
    const mine = getFakeState().stickers.filter((s) => s.childId === JANE && s.status === 'AVAILABLE')
    const cancelled = fake.createPrizeRequest(JANE, { stickerIds: [mine[0].id] })
    fake.cancelPrizeRequest(cancelled.id)
    const done = fake.createPrizeRequest(JANE, { stickerIds: [mine[0].id] })
    fake.completePrizeRequest(done.id, { prizeText: 'Ice cream' })
    const pending = fake.createPrizeRequest(JANE, { stickerIds: [mine[1].id] })

    const ids = (status?: string[] | string | null) => fake.listPrizeRequests({ status }).items.map((r) => r.id)
    const multi = ids(['COMPLETED', 'CANCELLED', 'REVERSED'])
    expect(multi).toContain(done.id)
    expect(multi).toContain(cancelled.id)
    expect(multi).not.toContain(pending.id)
    expect(ids('PENDING')).toEqual([pending.id])
    expect(ids(['PENDING'])).toEqual([pending.id])
    const all = ids()
    expect(all).toEqual(expect.arrayContaining([done.id, cancelled.id, pending.id]))
    expect(ids([])).toEqual(all)
    expect(code(() => fake.listPrizeRequests({ status: ['PENDING', 'BOGUS'] }))).toBe('400 VALIDATION_FAILED')
  })

  it('locks the PIN for 60 seconds after 5 wrong attempts', () => {
    resetFakeApi()
    for (let i = 4; i >= 1; i--) {
      try {
        fake.unlock({ pin: '0000' })
      } catch (e) {
        expect((e as FakeApiError).code).toBe('PIN_INCORRECT')
        expect((e as FakeApiError).extras.attemptsRemaining).toBe(i)
      }
    }
    try {
      fake.unlock({ pin: '0000' })
      expect.unreachable()
    } catch (e) {
      expect((e as FakeApiError).status).toBe(401)
      expect((e as FakeApiError).code).toBe('PIN_INCORRECT')
      expect((e as FakeApiError).extras.attemptsRemaining).toBe(0)
      expect((e as FakeApiError).extras.retryAfterSeconds).toBe(60)
    }
    expect(code(() => fake.unlock({ pin: '1234' }))).toBe('429 PIN_LOCKED')
    resetFakeApi('fresh-install')
    expect(code(() => fake.unlock({ pin: '1234' }))).toBe('409 PIN_NOT_SET')
  })

  it('allows skips on any date unless a sticker exists', () => {
    resetFakeApi()
    const r = janeMorning()
    const longAgo = fake.addDays(fake.today(), -400)
    expect(() => fake.addRoutineSkip(r.id, longAgo)).not.toThrow()
    expect(() => fake.addRoutineSkip(r.id, fake.addDays(fake.today(), 5))).not.toThrow()
    finishJaneMorning()
    expect(code(() => fake.addRoutineSkip(r.id, fake.today()))).toBe('409 ROUTINE_LOCKED')
  })

  it('seeds routine colors from the fixed palette', () => {
    resetFakeApi()
    const colors = getFakeState().routines.map((r) => r.color)
    expect(colors).toContain('#FFB703')
    expect(colors).toContain('#B388EB')
    expect(colors).not.toContain('#F4A261')
    expect(colors).not.toContain('#6C63FF')
  })

  it('empty library auto-awards the fallback', () => {
    resetFakeApi('empty-library')
    const res = finishJaneMorning()
    expect(res.pick).toMatchObject({ status: 'AVAILABLE', autoAwarded: true })
    expect(res.routine.state).toBe('EARNED')
    const sticker = getFakeState().stickers.find((s) => s.id === res.routine.sticker?.stickerId)
    expect(sticker).toMatchObject({ autoAwarded: true, status: 'AVAILABLE' })
    expect(res.routine.sticker?.design?.artworkKey).toBe('glowing-star')
  })

  it('hides the fallback design and guards library deletes', () => {
    resetFakeApi()
    const lib = fake.listDesigns({})
    expect(lib.designs).toHaveLength(24)
    expect(lib.activeCount).toBe(24)
    const fallback = getFakeState().designs.find((d) => d.isFallback)
    expect(code(() => fake.setDesignStatus(fallback?.id ?? 0, { status: 'RETIRED' }))).toBe('404 NOT_FOUND')
    const used = getFakeState().stickers.find((s) => s.designId !== null)
    expect(code(() => fake.deleteDesign(used?.designId ?? 0))).toBe('409 DESIGN_IN_USE')
  })

  it('computes history and supports setFakeToday', () => {
    resetFakeApi()
    const to = fake.addDays(fake.today(), -1)
    const h = fake.getHistory(JANE, fake.addDays(to, -6), to)
    expect(h.days).toHaveLength(7)
    const states = h.days.flatMap((d) => d.routines.map((r) => r.state))
    expect(states).toContain('EARNED')
    expect(states).toContain('MISSED')
    setFakeToday('2030-01-02')
    expect(fake.getBootstrap().today).toBe('2030-01-02')
  })
})

describe('fake API over fetch', () => {
  const headers = { 'X-Sticker-Bank': '1', 'Content-Type': 'application/json' }

  it('GET /api/bootstrap returns the typed shape', async () => {
    const res = await fetch('http://localhost/api/bootstrap')
    const body = (await res.json()) as Bootstrap
    expect(res.status).toBe(200)
    expect(body).toMatchObject({ setupRequired: false, appVersion: 'mock', timeZone: 'UTC' })
    expect(body.children.map((c) => c.name)).toEqual(['Jane Doe', 'John Doe'])
  })

  it('rejects a write without the CSRF header', async () => {
    const res = await fetch('http://localhost/api/parent/session', { method: 'POST', body: '{"pin":"1234"}' })
    expect(res.status).toBe(403)
    expect(res.headers.get('content-type')).toContain('application/problem+json')
    expect(((await res.json()) as ProblemDetail).code).toBe('CSRF_HEADER_MISSING')
  })

  it('requires a parent session for /api/parent/**', async () => {
    const res = await fetch('http://localhost/api/parent/children')
    expect(res.status).toBe(401)
    expect(((await res.json()) as ProblemDetail).code).toBe('PARENT_SESSION_REQUIRED')
    const unlock = await fetch('http://localhost/api/parent/session', {
      method: 'POST',
      headers,
      body: JSON.stringify({ pin: '1234' }),
    })
    expect(unlock.status).toBe(200)
    const again = await fetch('http://localhost/api/parent/children')
    expect(again.status).toBe(200)
    expect(await again.json()).toHaveLength(2)
  })

  it('completes a task through the handlers', async () => {
    const r = janeMorning()
    const res = await fetch(`http://localhost/api/children/${JANE}/days/${fake.today()}/tasks/${r.tasks[2].id}`, {
      method: 'PUT',
      headers,
    })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { routine: { doneCount: number } }).routine.doneCount).toBe(3)
  })

  it('offline scenario fails with a network error', async () => {
    resetFakeApi('offline')
    await expect(fetch('http://localhost/api/bootstrap')).rejects.toThrow()
  })
})

describe('fake API contract limits and the today alias', () => {
  const child = { avatarKey: 'bear', themeColor: '#aabbcc' }

  it('resolves the literal "today" for the daily chart but not for task writes', () => {
    resetFakeApi('default')
    const chart = fake.getDailyChart(JANE, 'today')
    expect(chart.date).toBe(fake.today())
    expect(chart.isToday).toBe(true)
    const r = janeMorning()
    expect(code(() => fake.completeTask(JANE, 'today', r.tasks[0].id))).toBe('400 VALIDATION_FAILED')
    expect(code(() => fake.getDailyChart(JANE, 'tomorrow'))).toBe('400 VALIDATION_FAILED')
  })

  it('serves GET /days/today over fetch', async () => {
    resetFakeApi('default')
    const res = await fetch(`http://localhost/api/children/${JANE}/days/today`)
    expect(res.status).toBe(200)
    expect(((await res.json()) as { isToday: boolean }).isToday).toBe(true)
  })

  it('child and category names allow 40 characters', () => {
    resetFakeApi('default')
    expect(code(() => fake.createChild({ ...child, name: 'a'.repeat(40) }))).toBe('ok')
    expect(code(() => fake.createChild({ ...child, name: 'a'.repeat(41) }))).toBe('400 VALIDATION_FAILED')
    expect(code(() => fake.createCategory({ name: 'c'.repeat(40) }))).toBe('ok')
    expect(code(() => fake.createCategory({ name: 'c'.repeat(41) }))).toBe('400 VALIDATION_FAILED')
  })

  it('routine and task names allow 60 characters and 30 tasks', () => {
    resetFakeApi('default')
    const task = (label: string) => ({ label, iconKey: 'star' })
    const routine = (name: string, tasks: { label: string; iconKey: string }[]) => ({ name, iconKey: 'sun', tasks })
    expect(code(() => fake.createRoutine(JANE, routine('r'.repeat(60), [task('t'.repeat(60))])))).toBe('ok')
    expect(code(() => fake.createRoutine(JANE, routine('r'.repeat(61), [])))).toBe('400 VALIDATION_FAILED')
    expect(code(() => fake.createRoutine(JANE, routine('ok', [task('t'.repeat(61))])))).toBe('400 VALIDATION_FAILED')
    const thirty = Array.from({ length: 30 }, (_, i) => task(`Task ${i}`))
    expect(code(() => fake.createRoutine(JANE, routine('Thirty', thirty)))).toBe('ok')
    expect(code(() => fake.createRoutine(JANE, routine('ThirtyOne', [...thirty, task('x')])))).toBe('400 VALIDATION_FAILED')
    expect(code(() => fake.createRoutine(JANE, routine('Empty', [])))).toBe('ok')
  })
})

describe('finish step (FR-6.6 to FR-6.11)', () => {
  it('the last task only makes the routine ready to finish and earns nothing', () => {
    resetFakeApi()
    const res = checkJaneMorning()
    expect(res.routine).toMatchObject({ state: 'READY_TO_FINISH', doneCount: 4, taskCount: 4, sticker: null })
    expect(res.pick).toBeNull()
    expect(getFakeState().stickers.filter((s) => s.routineId === janeMorning().id && s.chartDate === fake.today())).toHaveLength(0)
  })

  it('a task tapped by mistake is a plain undo while the routine is ready to finish', () => {
    resetFakeApi()
    checkJaneMorning()
    const r = janeMorning()
    const undone = fake.uncompleteTask(JANE, fake.today(), r.tasks[0].id)
    expect(undone.routine).toMatchObject({ state: 'IN_PROGRESS', doneCount: 3 })
    expect(undone.revoked).toBeNull()
    expect(code(() => fake.finishRoutine(JANE, fake.today(), r.id))).toBe('409 ROUTINE_NOT_READY')
    expect(fake.completeTask(JANE, fake.today(), r.tasks[0].id).routine.state).toBe('READY_TO_FINISH')
  })

  it('finishing is idempotent and returns the same saved choices', () => {
    resetFakeApi()
    const first = finishJaneMorning()
    const again = fake.finishRoutine(JANE, fake.today(), janeMorning().id)
    expect(again.routine.state).toBe('AWAITING_PICK')
    expect(again.pick?.stickerId).toBe(first.pick?.stickerId)
    expect(again.pick?.choices).toEqual(first.pick?.choices)
    expect(getFakeState().stickers.filter((s) => s.routineId === janeMorning().id && s.chartDate === fake.today())).toHaveLength(1)
  })

  it('finish rejects other children, skipped routines, future days and a child on a past day', () => {
    resetFakeApi()
    const r = janeMorning()
    expect(code(() => fake.finishRoutine(JOHN, fake.today(), r.id))).toBe('404 NOT_FOUND')
    expect(code(() => fake.finishRoutine(JANE, fake.addDays(fake.today(), 1), r.id))).toBe('422 FUTURE_DATE')
    expect(code(() => fake.finishRoutine(JANE, fake.addDays(fake.today(), -1), r.id))).toBe('409 DAY_CHANGED')
    fake.addRoutineSkip(r.id, fake.today())
    expect(code(() => fake.finishRoutine(JANE, fake.today(), r.id))).toBe('409 ROUTINE_NOT_SCHEDULED')
  })

  it('saving a routine that leaves every task done earns nothing (I-3)', () => {
    resetFakeApi('one-task-left')
    const r = janeMorning()
    const kept = r.tasks.slice(0, 3).map((t) => ({ id: t.id, label: t.label, iconKey: t.iconKey }))
    const saved = fake.updateRoutine(r.id, { name: r.name, iconKey: r.iconKey, color: r.color, days: r.days, paused: false, tasks: kept })
    expect(saved.appliesFromTomorrow).toBe(false)
    expect(fake.getDailyChart(JANE, fake.today()).routines[0]).toMatchObject({ state: 'READY_TO_FINISH', sticker: null })
  })

  it('the ready-to-finish scenario starts with the button showing and no sticker', () => {
    resetFakeApi('ready-to-finish')
    expect(fake.getDailyChart(JANE, fake.today()).routines[0]).toMatchObject({ state: 'READY_TO_FINISH', sticker: null })
  })

  describe('ending the day', () => {
    it('finishes a routine left ready to finish, unclaimed and marked automatic', () => {
      resetFakeApi()
      checkJaneMorning()
      setFakeToday(fake.addDays(fake.today(), 1))
      const chart = fake.getDailyChart(JANE, 'today')
      const yesterday = fake.addDays(fake.today(), -1)
      const tray = chart.unclaimedFromEarlierDays.find((u) => u.chartDate === yesterday)
      expect(tray).toBeDefined()
      const sticker = getFakeState().stickers.find((s) => s.id === tray?.stickerId)
      expect(sticker).toMatchObject({ status: 'UNCLAIMED', finishMode: 'AUTO', earnedAt: `${fake.addDays(yesterday, 1)}T00:00:00.000Z` })
      expect(sticker?.choices).toHaveLength(3)
      // idempotent
      fake.getDailyChart(JANE, 'today')
      expect(getFakeState().stickers.filter((s) => s.chartDate === yesterday && s.routineId === janeMorning().id)).toHaveLength(1)
      // only a parent session sees the flag
      expect(fake.getDailyChart(JANE, yesterday).routines[0].sticker?.autoFinished).toBeNull()
      setFakeParentSession(true)
      expect(fake.getDailyChart(JANE, yesterday).routines[0].sticker?.autoFinished).toBe(true)
      expect(fake.getHistory(JANE, yesterday, yesterday).days[0].routines[0].autoFinished).toBe(true)
    })

    it('leaves partly done and skipped routines alone', () => {
      resetFakeApi('one-task-left')
      const bedtime = getFakeState().routines.find((x) => x.childId === JANE && x.name === 'Bedtime')
      if (!bedtime) throw new Error('missing routine')
      bedtime.tasks.forEach((t) => fake.seedCompletion(t.id, fake.today()))
      fake.addRoutineSkip(bedtime.id, fake.today())
      fake.getDailyChart(JANE, 'today') // starts the watermark
      setFakeToday(fake.addDays(fake.today(), 1))
      expect(fake.getDailyChart(JANE, 'today').unclaimedFromEarlierDays).toHaveLength(0)
    })

    it('does not auto-finish a past day a parent edited after it was settled', () => {
      resetFakeApi()
      fake.getDailyChart(JANE, 'today')
      setFakeToday(fake.addDays(fake.today(), 1))
      fake.getDailyChart(JANE, 'today') // settles yesterday
      setFakeParentSession(true)
      const yesterday = fake.addDays(fake.today(), -1)
      const r = janeMorning()
      r.tasks.forEach((t) => fake.completeTask(JANE, yesterday, t.id))
      setFakeToday(fake.addDays(fake.today(), 1))
      fake.getDailyChart(JANE, 'today')
      expect(fake.getDailyChart(JANE, yesterday).routines[0].state).toBe('READY_TO_FINISH')
      expect(fake.finishRoutine(JANE, yesterday, r.id).routine.state).toBe('AWAITING_PICK')
    })

    it('the auto-finished scenario waits in the tray with a marked sticker', () => {
      resetFakeApi('auto-finished')
      const chart = fake.getDailyChart(JANE, 'today')
      expect(chart.unclaimedFromEarlierDays).toHaveLength(1)
      expect(fake.getStickerPick(chart.unclaimedFromEarlierDays[0].stickerId).choices).toHaveLength(3)
      setFakeParentSession(true)
      const yesterday = fake.addDays(fake.today(), -1)
      expect(fake.getDailyChart(JANE, yesterday).routines[0].sticker).toMatchObject({ autoFinished: true, status: 'UNCLAIMED' })
    })
  })
})
