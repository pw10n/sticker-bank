import { describe, expect, it } from 'vitest'
import { getFakeState, resetFakeApi, setFakeParentSession, setFakeToday } from './fakeApi'
import * as fake from './fakeState'
import { FakeApiError } from './fakeState'

const JANE = 1
const JOHN = 2
const BASE = 'http://localhost'
const TASKS = [
  { label: 'Blocks in the box', iconKey: 'basket' },
  { label: 'Books on the shelf', iconKey: 'open-book' },
  { label: 'Teddies on the bed', iconKey: 'teddy-bear' },
]

function code(fn: () => unknown): string {
  try {
    fn()
  } catch (e) {
    if (e instanceof FakeApiError) return `${e.status} ${e.code}`
    throw e
  }
  return 'ok'
}

const input = (over: Record<string, unknown> = {}) => ({ name: 'Wash the car', iconKey: 'broom', tasks: TASKS, ...over })
const assign = (over: Record<string, unknown> = {}, childId = JANE) => fake.assignChore(childId, input(over))
const checkAll = (childId: number, chore: { choreId: number; tasks: { taskId: number }[] }) =>
  chore.tasks.forEach((t) => fake.checkChoreTask(childId, chore.choreId, t.taskId))
const chart = (childId = JANE) => fake.getDailyChart(childId, 'today')

/** Assigns a chore, checks every task and taps I'm Done!. */
function finished(over: Record<string, unknown> = {}) {
  const chore = assign(over)
  checkAll(JANE, chore)
  const res = fake.finishChore(JANE, chore.choreId)
  return { chore, res }
}

describe('scenarios', () => {
  it('default and the others stay chore-free', () => {
    for (const name of ['default', 'one-task-left', 'ready-to-finish', 'pick-waiting', 'auto-finished', 'pending-request'] as const) {
      resetFakeApi(name)
      expect(getFakeState().chores).toEqual([])
      expect(chart().chores).toEqual([])
    }
  })

  it('chore-waiting: two chores to do', () => {
    resetFakeApi('chore-waiting')
    const [a, b] = chart().chores
    expect(a).toMatchObject({ choreId: 1, name: 'Feed the fish', dueDate: null, state: 'NOT_STARTED', taskCount: 1 })
    expect(b).toMatchObject({
      choreId: 2,
      name: 'Tidy the playroom',
      dueDate: fake.today(),
      state: 'IN_PROGRESS',
      doneCount: 1,
      taskCount: 3,
    })
    expect(b.tasks.map((t) => [t.taskId, t.done])).toEqual([
      [2, true],
      [3, false],
      [4, false],
    ])
    expect(chart(JOHN).chores).toEqual([])
  })

  it('chore-ready: every task checked', () => {
    resetFakeApi('chore-ready')
    const [c] = chart().chores
    expect(c).toMatchObject({ choreId: 1, state: 'READY_TO_FINISH', doneCount: 3, taskCount: 3, dueDate: null })
    expect(fake.finishChore(JANE, 1).pick).not.toBeNull()
  })
})

describe('assign and validation', () => {
  it('assigns an unchecked chore, last on the chart, in its own id space', () => {
    resetFakeApi('chore-waiting')
    const c = assign()
    expect(c).toMatchObject({ choreId: 3, childId: JANE, state: 'NOT_STARTED', doneCount: 0, closedOn: null, sticker: null })
    expect(c.tasks.map((t) => t.taskId)).toEqual([5, 6, 7])
    expect(chart().chores.map((x) => x.choreId)).toEqual([1, 2, 3])
  })

  it('does not use the routine counters', () => {
    resetFakeApi()
    const routines = getFakeState().nextId.routine
    const tasks = getFakeState().nextId.task
    assign()
    expect(getFakeState().nextId.routine).toBe(routines)
    expect(getFakeState().nextId.task).toBe(tasks)
  })

  it('collects every field error', () => {
    resetFakeApi()
    const bad = (over: Record<string, unknown>) => {
      try {
        assign(over)
      } catch (e) {
        if (e instanceof FakeApiError) return `${e.code} ${(e.extras.fieldErrors ?? []).map((f) => f.field).join(',')}`
      }
      return 'ok'
    }
    expect(bad({ name: '  ' })).toBe('VALIDATION_FAILED name')
    expect(bad({ name: 'x'.repeat(61) })).toBe('VALIDATION_FAILED name')
    expect(bad({ name: 'x'.repeat(60) })).toBe('ok')
    expect(bad({ tasks: [] })).toBe('VALIDATION_FAILED tasks')
    expect(bad({ tasks: [...TASKS, ...TASKS, ...TASKS].slice(0, 7) })).toBe('VALIDATION_FAILED tasks')
    expect(bad({ tasks: [...TASKS, ...TASKS] })).toBe('ok')
    expect(bad({ tasks: [{ label: '', iconKey: 'basket' }] })).toBe('VALIDATION_FAILED tasks[0].label')
    expect(bad({ tasks: [{ label: 'x'.repeat(61), iconKey: 'basket' }] })).toBe('VALIDATION_FAILED tasks[0].label')
    expect(bad({ iconKey: 'whale' })).toBe('VALIDATION_FAILED iconKey') // sticker-only artwork
    expect(bad({ iconKey: 'no-such-icon' })).toBe('VALIDATION_FAILED iconKey')
    expect(bad({ tasks: [{ label: 'a', iconKey: 'whale' }] })).toBe('VALIDATION_FAILED tasks[0].iconKey')
    expect(bad({ name: '', tasks: [] })).toBe('VALIDATION_FAILED name,tasks')
  })

  it('due date: empty, today or later; never in the past', () => {
    resetFakeApi()
    const t = fake.today()
    expect(code(() => assign({ dueDate: null }))).toBe('ok')
    expect(code(() => assign({ dueDate: t }))).toBe('ok')
    expect(code(() => assign({ dueDate: fake.addDays(t, 3) }))).toBe('ok')
    expect(code(() => assign({ dueDate: fake.addDays(t, -1) }))).toBe('400 VALIDATION_FAILED')
    expect(code(() => assign({ dueDate: 'tomorrow' }))).toBe('400 VALIDATION_FAILED')
  })

  it('an unknown child is 404', () => {
    resetFakeApi()
    expect(code(() => assign({}, 99))).toBe('404 NOT_FOUND')
  })
})

describe('limit of 5 unfinished chores', () => {
  it('refuses the sixth, counts only unfinished ones, per child', () => {
    resetFakeApi()
    for (let i = 0; i < 5; i++) assign()
    expect(code(() => assign())).toBe('409 CHORE_LIMIT_REACHED')
    expect(code(() => assign({}, JOHN))).toBe('ok')
    // a finished chore stops counting
    const first = chart().chores[0]
    checkAll(JANE, first)
    fake.finishChore(JANE, first.choreId)
    expect(code(() => assign())).toBe('ok')
    // a removed chore stops counting
    const second = chart().chores.find((c) => c.state === 'NOT_STARTED')
    if (!second) throw new Error('no chore')
    expect(code(() => assign())).toBe('409 CHORE_LIMIT_REACHED')
    fake.removeChoreById(second.choreId)
    expect(code(() => assign())).toBe('ok')
  })

  it('a READY_TO_FINISH chore still counts', () => {
    resetFakeApi()
    const c = assign()
    checkAll(JANE, c)
    for (let i = 0; i < 4; i++) assign()
    expect(code(() => assign())).toBe('409 CHORE_LIMIT_REACHED')
  })
})

describe('alreadyDone', () => {
  it('checks every task as PARENT, earns at once, skips the limit and takes no due date', () => {
    resetFakeApi()
    setFakeParentSession(true)
    for (let i = 0; i < 5; i++) assign()
    const c = assign({ alreadyDone: true })
    expect(c.state).toBe('AWAITING_PICK')
    expect(c.doneCount).toBe(3)
    expect(c.sticker).toMatchObject({ status: 'UNCLAIMED', autoFinished: false })
    const sticker = getFakeState().stickers.find((s) => s.choreId === c.choreId)
    expect(sticker).toMatchObject({
      source: 'CHORE',
      routineId: null,
      chartDate: fake.today(),
      routineName: 'Wash the car',
      routineIconKey: 'broom',
      finishMode: 'TAPPED',
    })
    expect(sticker?.choices).toHaveLength(3)
    const chore = getFakeState().chores.find((x) => x.id === c.choreId)
    expect(chore?.tasks.every((t) => t.checkedBy === 'PARENT')).toBe(true)
    expect(c.closedOn).toBe(fake.today())
    expect(code(() => assign({ alreadyDone: true, dueDate: fake.today() }))).toBe('400 VALIDATION_FAILED')
  })

  it('earns the fallback straight away when the pool is empty', () => {
    resetFakeApi('empty-library')
    const c = assign({ alreadyDone: true })
    expect(c.state).toBe('EARNED')
    expect(c.sticker?.design).not.toBeNull()
  })

  it('is refused on a save', () => {
    resetFakeApi()
    const c = assign()
    expect(code(() => fake.saveChore(c.choreId, input({ alreadyDone: true })))).toBe('400 VALIDATION_FAILED')
    expect(code(() => fake.saveChore(c.choreId, input({ alreadyDone: false })))).toBe('ok')
  })
})

describe('state derivation and the chart', () => {
  it('moves NOT_STARTED, IN_PROGRESS, READY_TO_FINISH and back', () => {
    resetFakeApi()
    const c = assign()
    const [t1, t2, t3] = c.tasks.map((t) => t.taskId)
    expect(fake.checkChoreTask(JANE, c.choreId, t1).chore?.state).toBe('IN_PROGRESS')
    fake.checkChoreTask(JANE, c.choreId, t2)
    const ready = fake.checkChoreTask(JANE, c.choreId, t3)
    expect(ready.chore).toMatchObject({ state: 'READY_TO_FINISH', doneCount: 3 })
    expect(ready.pick).toBeNull() // nothing is earned by the last check (BR-21)
    expect(fake.uncheckChoreTask(JANE, c.choreId, t3).chore?.state).toBe('IN_PROGRESS')
    fake.uncheckChoreTask(JANE, c.choreId, t2)
    expect(fake.uncheckChoreTask(JANE, c.choreId, t1).chore?.state).toBe('NOT_STARTED')
  })

  it('a one-task chore goes straight to READY_TO_FINISH', () => {
    resetFakeApi()
    const c = assign({ tasks: [TASKS[0]] })
    expect(fake.checkChoreTask(JANE, c.choreId, c.tasks[0].taskId).chore?.state).toBe('READY_TO_FINISH')
  })

  it('check and undo are idempotent and keep the first actor', () => {
    resetFakeApi()
    const c = assign()
    const id = c.tasks[0].taskId
    fake.checkChoreTask(JANE, c.choreId, id)
    setFakeParentSession(true)
    fake.checkChoreTask(JANE, c.choreId, id)
    expect(getFakeState().chores[0].tasks[0].checkedBy).toBe('CHILD')
    fake.uncheckChoreTask(JANE, c.choreId, id)
    expect(code(() => fake.uncheckChoreTask(JANE, c.choreId, id))).toBe('ok')
    fake.checkChoreTask(JANE, c.choreId, id)
    expect(getFakeState().chores[0].tasks[0].checkedBy).toBe('PARENT')
  })

  it('404 for a foreign chore, a task of another chore, an unknown or removed chore', () => {
    resetFakeApi()
    const a = assign()
    const b = assign()
    expect(code(() => fake.checkChoreTask(JOHN, a.choreId, a.tasks[0].taskId))).toBe('404 NOT_FOUND')
    expect(code(() => fake.checkChoreTask(JANE, a.choreId, b.tasks[0].taskId))).toBe('404 NOT_FOUND')
    expect(code(() => fake.checkChoreTask(JANE, 999, 1))).toBe('404 NOT_FOUND')
    expect(code(() => fake.finishChore(JOHN, a.choreId))).toBe('404 NOT_FOUND')
    setFakeParentSession(true)
    fake.removeChoreById(a.choreId)
    expect(code(() => fake.checkChoreTask(JANE, a.choreId, a.tasks[0].taskId))).toBe('404 NOT_FOUND')
    expect(code(() => fake.uncheckChoreTask(JANE, a.choreId, a.tasks[0].taskId))).toBe('404 NOT_FOUND')
    expect(code(() => fake.finishChore(JANE, a.choreId))).toBe('404 NOT_FOUND')
  })

  it('shows unfinished chores on today only, plus those finished today; a past day shows what closed then', () => {
    resetFakeApi()
    const t = fake.today()
    const open = assign()
    const { chore: done } = finished({ name: 'Done chore' })
    expect(chart().chores.map((c) => c.choreId)).toEqual([open.choreId, done.choreId])
    expect(fake.getDailyChart(JANE, fake.addDays(t, -1)).chores).toEqual([])
    const history = fake.getHistory(JANE, fake.addDays(t, -1), t).days
    expect(history[0].chores).toEqual([])
    expect(history[1].chores.map((c) => c.choreId)).toEqual([open.choreId, done.choreId])
    expect(history[1].chores[1]).toMatchObject({ state: 'AWAITING_PICK', doneCount: 3, autoFinished: false })
    expect(history[1].chores[1].stickerId).not.toBeNull()
    expect(history[1].chores[0].stickerId).toBeNull()
  })

  it('orders by creation, oldest first, ids breaking ties', () => {
    resetFakeApi()
    const a = assign({ name: 'A' })
    const b = assign({ name: 'B' })
    const c = assign({ name: 'C' })
    expect(chart().chores.map((x) => x.choreId)).toEqual([a.choreId, b.choreId, c.choreId])
  })

  it('only a parent session sees the review fields of a chore sticker', () => {
    resetFakeApi()
    const { chore } = finished()
    expect(chart().chores[0].sticker).toMatchObject({ prizeRequestId: null, revocable: null, autoFinished: null })
    setFakeParentSession(true)
    expect(chart().chores[0].sticker).toMatchObject({ revocable: true, autoFinished: false })
    expect(chore.choreId).toBe(chart().chores[0].choreId)
  })

  it('a chore sticker carries the chore name and icon and shows in the book', () => {
    resetFakeApi()
    const { res } = finished({ name: 'Wash the car' })
    const sticker = getFakeState().stickers.find((s) => s.id === res.pick?.stickerId)
    expect(res.pick).toMatchObject({ routineName: 'Wash the car', choices: expect.any(Array) })
    if (!sticker) throw new Error('no sticker')
    fake.claimStickerPick(sticker.id, { designId: sticker.choices[0] })
    const item = fake.getStickerBook(JANE).items.find((i) => i.stickerId === sticker.id)
    expect(item).toMatchObject({ source: 'CHORE', routineName: 'Wash the car', routineIconKey: 'broom' })
  })
})

describe('finish', () => {
  it('earns one sticker, returns the pick, and is idempotent with the same choices', () => {
    resetFakeApi()
    const { chore, res } = finished()
    expect(res.chore?.state).toBe('AWAITING_PICK')
    expect(res.pick?.choices).toHaveLength(3)
    const again = fake.finishChore(JANE, chore.choreId)
    expect(again.pick?.choices).toEqual(res.pick?.choices)
    expect(again.pick?.stickerId).toBe(res.pick?.stickerId)
    expect(getFakeState().stickers.filter((s) => s.choreId === chore.choreId)).toHaveLength(1)
  })

  it('after the claim a repeat has no pick and the chore is EARNED', () => {
    resetFakeApi()
    const { chore, res } = finished()
    fake.claimStickerPick(res.pick?.stickerId ?? 0, { designId: res.pick?.choices[0].designId })
    const again = fake.finishChore(JANE, chore.choreId)
    expect(again.pick).toBeNull()
    expect(again.chore?.state).toBe('EARNED')
  })

  it('CHORE_NOT_READY when a task is unchecked', () => {
    resetFakeApi()
    const c = assign()
    fake.checkChoreTask(JANE, c.choreId, c.tasks[0].taskId)
    expect(code(() => fake.finishChore(JANE, c.choreId))).toBe('409 CHORE_NOT_READY')
    expect(getFakeState().stickers.some((s) => s.choreId === c.choreId)).toBe(false)
  })

  it('a locked chore: PUT unchanged, child DELETE CHORE_LOCKED', () => {
    resetFakeApi()
    const { chore } = finished()
    const id = chore.tasks[0].taskId
    expect(fake.checkChoreTask(JANE, chore.choreId, id).chore?.state).toBe('AWAITING_PICK')
    expect(code(() => fake.uncheckChoreTask(JANE, chore.choreId, id))).toBe('409 CHORE_LOCKED')
  })

  it('works for a parent session too, with the same calls (FR-13.22)', () => {
    resetFakeApi()
    setFakeParentSession(true)
    const c = assign()
    checkAll(JANE, c)
    expect(fake.finishChore(JANE, c.choreId).pick).not.toBeNull()
  })
})

describe('edit', () => {
  it('keeps checks by task id, creates new tasks unchecked, drops the rest, and never earns', () => {
    resetFakeApi()
    const c = assign()
    const [t1, t2, t3] = c.tasks.map((t) => t.taskId)
    fake.checkChoreTask(JANE, c.choreId, t1)
    fake.checkChoreTask(JANE, c.choreId, t3)
    const saved = fake.saveChore(
      c.choreId,
      input({
        name: 'Renamed',
        tasks: [
          { id: t3, label: 'Third first', iconKey: 'teddy-bear' },
          { id: t1, label: 'One', iconKey: 'basket' },
          { label: 'Brand new', iconKey: 'broom' },
        ],
      }),
    )
    expect(saved.name).toBe('Renamed')
    expect(saved.tasks.map((t) => [t.taskId === t3 || t.taskId === t1 ? t.taskId : 'new', t.done])).toEqual([
      [t3, true],
      [t1, true],
      ['new', false],
    ])
    expect(saved.tasks.some((t) => t.taskId === t2)).toBe(false)
    expect(saved.tasks[2].taskId).toBeGreaterThan(t3)
    expect(saved.state).toBe('IN_PROGRESS')
  })

  it('an edit that leaves everything checked is only READY_TO_FINISH', () => {
    resetFakeApi()
    const c = assign()
    fake.checkChoreTask(JANE, c.choreId, c.tasks[0].taskId)
    const saved = fake.saveChore(c.choreId, input({ tasks: [{ id: c.tasks[0].taskId, label: 'Only', iconKey: 'basket' }] }))
    expect(saved.state).toBe('READY_TO_FINISH')
    expect(saved.sticker).toBeNull()
    expect(getFakeState().stickers.some((s) => s.choreId === c.choreId)).toBe(false)
  })

  it('CHORE_LOCKED on a finished chore, 404 on a removed one, validation applies', () => {
    resetFakeApi()
    const { chore } = finished()
    expect(code(() => fake.saveChore(chore.choreId, input()))).toBe('409 CHORE_LOCKED')
    const other = assign({ name: 'Other' })
    expect(code(() => fake.saveChore(other.choreId, input({ name: '' })))).toBe('400 VALIDATION_FAILED')
    expect(code(() => fake.saveChore(other.choreId, input({ dueDate: fake.addDays(fake.today(), -1) })))).toBe('400 VALIDATION_FAILED')
    fake.removeChoreById(other.choreId)
    expect(code(() => fake.saveChore(other.choreId, input()))).toBe('404 NOT_FOUND')
  })
})

describe('remove', () => {
  it('is soft, repeatable, and refused on a finished chore', () => {
    resetFakeApi()
    const c = assign()
    fake.removeChoreById(c.choreId)
    expect(getFakeState().chores).toHaveLength(1)
    expect(getFakeState().chores[0].removed).toBe(true)
    expect(chart().chores).toEqual([])
    expect(fake.listChores({ filter: 'active' }).items).toEqual([])
    expect(code(() => fake.removeChoreById(c.choreId))).toBe('ok')
    expect(code(() => fake.removeChoreById(999))).toBe('404 NOT_FOUND')
    const { chore } = finished({ name: 'Keep' })
    expect(code(() => fake.removeChoreById(chore.choreId))).toBe('409 CHORE_LOCKED')
  })

  it('deleting a child deletes their chores', () => {
    resetFakeApi()
    assign({}, JOHN)
    fake.deleteChild(JOHN)
    expect(getFakeState().chores).toEqual([])
  })
})

describe('revoke', () => {
  it('needs confirmation from a parent, with the sticker; a child is locked', () => {
    resetFakeApi()
    const { chore } = finished()
    const id = chore.tasks[1].taskId
    setFakeParentSession(true)
    try {
      fake.uncheckChoreTask(JANE, chore.choreId, id)
      throw new Error('expected a conflict')
    } catch (e) {
      expect(e).toBeInstanceOf(FakeApiError)
      if (!(e instanceof FakeApiError)) throw e
      expect(e.code).toBe('REVOKE_CONFIRMATION_REQUIRED')
      expect(e.extras.sticker).toMatchObject({ status: 'UNCLAIMED', revocable: true })
    }
    expect(getFakeState().chores[0].tasks.every((t) => t.checkedBy !== null)).toBe(true)
  })

  it('revokes, leaves the other tasks checked, and a re-earn offers the same choices', () => {
    resetFakeApi()
    const { chore, res } = finished()
    const id = chore.tasks[1].taskId
    setFakeParentSession(true)
    const out = fake.uncheckChoreTask(JANE, chore.choreId, id, { revokeSticker: true, note: 'not tidy' })
    expect(out.revoked).toMatchObject({ stickerId: res.pick?.stickerId, fromStatus: 'UNCLAIMED', requestCancelled: false })
    expect(out.chore).toMatchObject({ state: 'IN_PROGRESS', doneCount: 2, sticker: null })
    expect(out.chore?.tasks.map((t) => t.done)).toEqual([true, false, true])
    const row = getFakeState().revocations[0]
    expect(row).toMatchObject({
      choreId: chore.choreId,
      routineId: null,
      taskId: null,
      taskLabel: 'Books on the shelf',
      routineName: 'Wash the car',
      note: 'not tidy',
      chartDate: fake.today(),
    })
    expect(fake.getHistory(JANE, fake.today(), fake.today()).days[0].revocations).toHaveLength(1)
    // a repeat: no live sticker and the task already unchecked, so the current state and no `revoked`
    const repeat = fake.uncheckChoreTask(JANE, chore.choreId, id, { revokeSticker: true })
    expect(repeat.revoked).toBeNull()
    expect(repeat.chore?.state).toBe('IN_PROGRESS')
    // re-earn
    fake.checkChoreTask(JANE, chore.choreId, id)
    expect(fake.finishChore(JANE, chore.choreId).pick?.choices).toEqual(res.pick?.choices)
    expect(fake.getStickerPick(res.pick?.stickerId ?? 0).choices).toEqual([])
  })

  it('a one-task chore goes back to NOT_STARTED', () => {
    resetFakeApi()
    const { chore } = finished({ tasks: [TASKS[0]] })
    setFakeParentSession(true)
    const out = fake.uncheckChoreTask(JANE, chore.choreId, chore.tasks[0].taskId, { revokeSticker: true })
    expect(out.chore?.state).toBe('NOT_STARTED')
  })

  it('a Used sticker is refused and nothing changes', () => {
    resetFakeApi()
    const { chore, res } = finished({ tasks: [TASKS[0]] })
    const sticker = getFakeState().stickers.find((s) => s.id === res.pick?.stickerId)
    if (!sticker) throw new Error('no sticker')
    fake.claimStickerPick(sticker.id, { designId: sticker.choices[0] })
    fake.seedPrizeRequest({ childId: JANE, stickerIds: [sticker.id], status: 'COMPLETED' })
    setFakeParentSession(true)
    expect(code(() => fake.uncheckChoreTask(JANE, chore.choreId, chore.tasks[0].taskId, { revokeSticker: true }))).toBe(
      '409 STICKER_USED',
    )
    expect(getFakeState().chores[0].tasks[0].checkedBy).not.toBeNull()
    expect(getFakeState().revocations).toEqual([])
  })

  it('takes a Pending sticker out of its request, cancelling an empty one', () => {
    resetFakeApi()
    const a = finished({ name: 'A', tasks: [TASKS[0]] })
    const b = finished({ name: 'B', tasks: [TASKS[0]] })
    for (const r of [a.res, b.res]) {
      const s = getFakeState().stickers.find((x) => x.id === r.pick?.stickerId)
      if (!s) throw new Error('no sticker')
      fake.claimStickerPick(s.id, { designId: s.choices[0] })
    }
    setFakeParentSession(true)
    const request = fake.createPrizeRequest(JANE, { stickerIds: [a.res.pick?.stickerId, b.res.pick?.stickerId] })
    const first = fake.uncheckChoreTask(JANE, a.chore.choreId, a.chore.tasks[0].taskId, { revokeSticker: true })
    expect(first.revoked).toMatchObject({ fromStatus: 'PENDING', prizeRequestId: request.id, requestCancelled: false })
    expect(fake.getPendingPrizeRequest(JANE).request?.stickerCount).toBe(1)
    const last = fake.uncheckChoreTask(JANE, b.chore.choreId, b.chore.tasks[0].taskId, { revokeSticker: true })
    expect(last.revoked).toMatchObject({ fromStatus: 'PENDING', requestCancelled: true })
    expect(fake.getPendingPrizeRequest(JANE).request).toBeNull()
    expect(getFakeState().prizeRequests.find((r) => r.id === request.id)).toMatchObject({ status: 'CANCELLED', cancelReason: 'ALL_STICKERS_REVOKED' })
  })

  it('removeChore returns chore null and the repeat is a 404', () => {
    resetFakeApi()
    const { chore } = finished()
    setFakeParentSession(true)
    const id = chore.tasks[0].taskId
    const out = fake.uncheckChoreTask(JANE, chore.choreId, id, { revokeSticker: true, removeChore: true })
    expect(out.chore).toBeNull()
    expect(out.revoked).not.toBeNull()
    expect(chart().chores).toEqual([])
    expect(getFakeState().revocations).toHaveLength(1)
    expect(code(() => fake.uncheckChoreTask(JANE, chore.choreId, id, { revokeSticker: true, removeChore: true }))).toBe(
      '404 NOT_FOUND',
    )
  })
})

describe('due dates, missed chores and the fake day', () => {
  /** Jane's chore due today, then the fake day moves on. */
  function dueToday(checked: number) {
    resetFakeApi('chore-waiting')
    const chore = getFakeState().chores[1]
    chore.tasks.forEach((t, i) => {
      t.checkedBy = i < checked ? 'CHILD' : null
    })
    return chore
  }

  it('a chore with unfinished tasks is MISSED the next day and leaves the chart', () => {
    const chore = dueToday(1)
    setFakeToday(fake.addDays(fake.today(), 1))
    expect(chart().chores.map((c) => c.choreId)).toEqual([1]) // the undated chore carries over
    const closed = fake.listChores({ filter: 'closed' }).items
    expect(closed).toHaveLength(1)
    expect(closed[0]).toMatchObject({ choreId: chore.id, state: 'MISSED', closedOn: chore.dueDate, doneCount: 1 })
    const day = fake.getHistory(JANE, chore.dueDate ?? '', chore.dueDate ?? '').days[0]
    expect(day.chores[0]).toMatchObject({ choreId: chore.id, state: 'MISSED', stickerId: null })
    expect(fake.getDailyChart(JANE, chore.dueDate ?? '').chores.map((c) => c.state)).toEqual(['MISSED'])
  })

  it('a MISSED chore refuses PUT and finish, but never a DELETE', () => {
    const chore = dueToday(1)
    setFakeToday(fake.addDays(fake.today(), 1))
    const [t1, t2] = chore.tasks.map((t) => t.id)
    expect(code(() => fake.checkChoreTask(JANE, chore.id, t2))).toBe('409 CHORE_MISSED')
    expect(code(() => fake.finishChore(JANE, chore.id))).toBe('409 CHORE_MISSED')
    expect(code(() => fake.uncheckChoreTask(JANE, chore.id, t1))).toBe('ok')
    expect(code(() => fake.uncheckChoreTask(JANE, chore.id, t1))).toBe('ok')
  })

  it('a fully checked chore is finished automatically: dated the due date, AUTO, unclaimed', () => {
    const chore = dueToday(3)
    const due = chore.dueDate ?? ''
    setFakeToday(fake.addDays(due, 1))
    const c = chart().chores.find((x) => x.choreId === chore.id)
    expect(c).toBeUndefined() // chart date is the due date, not today
    const sticker = getFakeState().stickers.find((s) => s.choreId === chore.id)
    expect(sticker).toMatchObject({
      chartDate: due,
      finishMode: 'AUTO',
      status: 'UNCLAIMED',
      earnedAt: `${fake.addDays(due, 1)}T00:00:00.000Z`,
    })
    const tray = chart().unclaimedFromEarlierDays
    expect(tray.map((t) => t.routineName)).toContain('Tidy the playroom')
    expect(fake.getDailyChart(JANE, due).chores[0]).toMatchObject({ state: 'AWAITING_PICK' })
    setFakeParentSession(true)
    expect(fake.getDailyChart(JANE, due).chores[0].sticker?.autoFinished).toBe(true)
    expect(fake.getHistory(JANE, due, due).days[0].chores[0]).toMatchObject({ autoFinished: true })
    // settling twice changes nothing
    fake.getDailyChart(JANE, due)
    expect(getFakeState().stickers.filter((s) => s.choreId === chore.id)).toHaveLength(1)
  })

  it('a tap after the due date ended finds the sticker already made (I-29)', () => {
    const chore = dueToday(3)
    setFakeToday(fake.addDays(fake.today(), 1))
    const res = fake.finishChore(JANE, chore.id)
    expect(res.pick).not.toBeNull()
    expect(getFakeState().stickers.find((s) => s.choreId === chore.id)?.finishMode).toBe('AUTO')
  })

  it('a chore with no due date carries over however many days pass', () => {
    resetFakeApi('chore-ready')
    setFakeToday(fake.addDays(fake.today(), 5))
    const [c] = chart().chores
    expect(c.state).toBe('READY_TO_FINISH')
    expect(getFakeState().stickers.some((s) => s.choreId !== null)).toBe(false)
  })

  it('reopening a MISSED chore keeps its checks, needs a date from today on, and checks the limit', () => {
    const chore = dueToday(1)
    setFakeToday(fake.addDays(fake.today(), 1))
    const now = fake.today()
    const same = input({ name: chore.name, iconKey: chore.iconKey, tasks: chore.tasks.map((t) => ({ id: t.id, label: t.label, iconKey: t.iconKey })) })
    expect(code(() => fake.saveChore(chore.id, { ...same, dueDate: chore.dueDate }))).toBe('400 VALIDATION_FAILED')
    for (let i = 0; i < 4; i++) assign()
    expect(code(() => fake.saveChore(chore.id, { ...same, dueDate: now }))).toBe('409 CHORE_LIMIT_REACHED')
    fake.removeChoreById(chart().chores[1].choreId)
    const saved = fake.saveChore(chore.id, { ...same, dueDate: fake.addDays(now, 2) })
    expect(saved).toMatchObject({ state: 'IN_PROGRESS', doneCount: 1, closedOn: null })
    expect(chart().chores.map((c) => c.choreId)).toContain(chore.id)
    // no date at all works too
    expect(fake.saveChore(chore.id, { ...same, dueDate: null }).dueDate).toBeNull()
  })

  it('removing a MISSED chore takes it off the closed list', () => {
    const chore = dueToday(0)
    setFakeToday(fake.addDays(fake.today(), 1))
    expect(fake.listChores({ filter: 'closed' }).items).toHaveLength(1)
    fake.removeChoreById(chore.id)
    expect(fake.listChores({ filter: 'closed' }).items).toEqual([])
  })
})

describe('lists', () => {
  it('active: every unfinished chore, child by child in chart order, optionally for one child', () => {
    resetFakeApi()
    const j1 = assign({ name: 'J1' }, JANE)
    const o1 = assign({ name: 'O1' }, JOHN)
    const j2 = assign({ name: 'J2' }, JANE)
    const { chore: done } = finished({ name: 'Done' })
    const all = fake.listChores({ filter: 'active' })
    expect(all.nextCursor).toBeNull()
    expect(all.items.map((c) => c.choreId)).toEqual([j1.choreId, j2.choreId, o1.choreId])
    expect(all.items.every((c) => c.choreId !== done.choreId)).toBe(true)
    expect(fake.listChores({ filter: 'active', childId: JOHN }).items.map((c) => c.choreId)).toEqual([o1.choreId])
    expect(all.items[0]).toMatchObject({ childId: JANE, closedOn: null })
    expect(typeof all.items[0].createdAt).toBe('string')
  })

  it('rejects an unknown filter', () => {
    resetFakeApi()
    expect(code(() => fake.listChores({ filter: 'nope' }))).toBe('400 VALIDATION_FAILED')
    expect(code(() => fake.listChores({}))).toBe('400 VALIDATION_FAILED')
    expect(code(() => fake.listChores({ filter: 'active', childId: 99 }))).toBe('404 NOT_FOUND')
  })

  it('closed: finished and recently missed chores, newest first, paged by cursor', () => {
    resetFakeApi()
    const t = fake.today()
    const st = getFakeState()
    // 55 finished chores on assorted days, built straight in the state
    for (let i = 0; i < 55; i++) {
      const chore = fake.seedChore({ childId: JANE, name: `Old ${i}`, iconKey: 'broom', tasks: [{ label: 'x', iconKey: 'basket', checked: true }] })
      fake.earnChoreSticker(chore, fake.addDays(t, -(i % 20)), 'TAPPED')
    }
    expect(st.chores).toHaveLength(55)
    const page1 = fake.listChores({ filter: 'closed' })
    expect(page1.items).toHaveLength(50)
    expect(page1.nextCursor).not.toBeNull()
    const days = page1.items.map((c) => c.closedOn ?? '')
    expect([...days].sort().reverse()).toEqual(days)
    const page2 = fake.listChores({ filter: 'closed', cursor: page1.nextCursor })
    expect(page2.items).toHaveLength(5)
    expect(page2.nextCursor).toBeNull()
    const ids = new Set([...page1.items, ...page2.items].map((c) => c.choreId))
    expect(ids.size).toBe(55)
  })

  it('closed drops chores missed more than 30 days ago, keeps finished ones', () => {
    resetFakeApi()
    const t = fake.today()
    const stale = fake.seedChore({ childId: JANE, name: 'Stale', iconKey: 'broom', dueDate: fake.addDays(t, -31), tasks: [{ label: 'x', iconKey: 'basket' }] })
    const edge = fake.seedChore({ childId: JANE, name: 'Edge', iconKey: 'broom', dueDate: fake.addDays(t, -30), tasks: [{ label: 'x', iconKey: 'basket' }] })
    const oldDone = fake.seedChore({ childId: JANE, name: 'Old done', iconKey: 'broom', tasks: [{ label: 'x', iconKey: 'basket', checked: true }] })
    fake.earnChoreSticker(oldDone, fake.addDays(t, -90), 'TAPPED')
    const ids = fake.listChores({ filter: 'closed' }).items.map((c) => c.choreId)
    expect(ids).toContain(edge.id)
    expect(ids).toContain(oldDone.id)
    expect(ids).not.toContain(stale.id)
  })

  it('recent: up to 12 distinct names, latest first, with tasks, removed ones included', () => {
    resetFakeApi()
    for (let i = 0; i < 14; i++) {
      const c = assign({ name: `Chore ${i}` })
      fake.removeChoreById(c.choreId) // keeps the limit out of the way
    }
    assign({ name: 'Chore 3', tasks: [{ label: 'Fresh', iconKey: 'broom' }] })
    const recent = fake.recentChores()
    expect(recent).toHaveLength(12)
    expect(recent[0]).toEqual({ name: 'Chore 3', iconKey: 'broom', tasks: [{ label: 'Fresh', iconKey: 'broom' }] })
    expect(recent[1].name).toBe('Chore 13')
    expect(new Set(recent.map((r) => r.name)).size).toBe(12)
    expect(recent[1].tasks).toEqual(TASKS)
  })
})

describe('chores over fetch', () => {
  const H = { 'X-Sticker-Bank': '1' }

  it('serves the eight endpoints, and chores need a parent session where the parent does', async () => {
    resetFakeApi('chore-waiting')
    expect((await fetch(`${BASE}/api/parent/chores?filter=active`)).status).toBe(401)
    setFakeParentSession(true)
    const created = await fetch(`${BASE}/api/parent/children/${JANE}/chores`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify(input()),
    })
    expect(created.status).toBe(201)
    const chore = (await created.json()) as { choreId: number; tasks: { taskId: number }[] }
    const list = await fetch(`${BASE}/api/parent/chores?filter=active&childId=${JANE}`)
    expect(((await list.json()) as { items: unknown[] }).items).toHaveLength(3)
    expect((await fetch(`${BASE}/api/parent/chores/recent`)).status).toBe(200)
    const saved = await fetch(`${BASE}/api/parent/chores/${chore.choreId}`, { method: 'PUT', headers: H, body: JSON.stringify(input({ name: 'New' })) })
    expect(saved.status).toBe(200)
    chore.tasks = ((await saved.json()) as typeof chore).tasks
    const path = `${BASE}/api/children/${JANE}/chores/${chore.choreId}`
    for (const t of chore.tasks) expect((await fetch(`${path}/tasks/${t.taskId}`, { method: 'PUT', headers: H })).status).toBe(200)
    const fin = await fetch(`${path}/finish`, { method: 'POST', headers: H })
    expect(((await fin.json()) as { pick: { choices: unknown[] } }).pick.choices).toHaveLength(3)
    const needs = await fetch(`${path}/tasks/${chore.tasks[0].taskId}`, { method: 'DELETE', headers: H })
    expect(needs.status).toBe(409)
    expect(((await needs.json()) as { code: string }).code).toBe('REVOKE_CONFIRMATION_REQUIRED')
    const revoked = await fetch(`${path}/tasks/${chore.tasks[0].taskId}?revokeSticker=true&removeChore=true`, {
      method: 'DELETE',
      headers: H,
      body: JSON.stringify({ note: 'oops' }),
    })
    const body = (await revoked.json()) as { chore: unknown; revoked: unknown }
    expect(body.chore).toBeNull()
    expect(body.revoked).not.toBeNull()
    const other = await fetch(`${BASE}/api/parent/chores/${chart().chores[0].choreId}`, { method: 'DELETE', headers: H })
    expect(other.status).toBe(204)
    expect((await fetch(`${BASE}/api/parent/chores?filter=bogus`)).status).toBe(400)
  })
})
