import type { ScenarioName } from './fakeApi'
import {
  addDays,
  earnSticker,
  getState,
  resetState,
  seedChild,
  seedCompletion,
  seedPrizeRequest,
  seedRoutine,
  seedSticker,
  today,
  noonIso,
  type FakeChild,
  type FakeRoutine,
  type FakeSticker,
} from './fakeState'

export const DEMO_PIN = '1234'

interface DayPlan {
  /** Days before today. */
  ago: number
  /** `earned` completes everything and earns a sticker; a number completes that many tasks only. */
  outcome: 'earned' | number
}

function seedFamily(): { jane: FakeChild; john: FakeChild } {
  const s = getState()
  s.settings.pin = DEMO_PIN
  s.settings.pinSetAt = noonIso(addDays(today(), -30))
  const jane = seedChild({ name: 'Jane Doe', avatarKey: 'cat-face', themeColor: '#FFB703' })
  const john = seedChild({ name: 'John Doe', avatarKey: 'dog-face', themeColor: '#4CC9F0' })
  return { jane, john }
}

function seedRoutines(child: FakeChild): { morning: FakeRoutine; bedtime: FakeRoutine } {
  const effectiveFrom = addDays(today(), -30)
  const morning = seedRoutine({
    childId: child.id,
    name: 'Morning Routine',
    iconKey: 'sun',
    color: '#FFB703',
    effectiveFrom,
    tasks: [
      { label: 'Brush teeth', iconKey: 'toothbrush' },
      { label: 'Get dressed', iconKey: 't-shirt' },
      { label: 'Eat breakfast', iconKey: 'bowl-with-spoon' },
      { label: 'Shoes on', iconKey: 'sneaker' },
    ],
  })
  const bedtime = seedRoutine({
    childId: child.id,
    name: 'Bedtime',
    iconKey: 'crescent-moon',
    color: '#B388EB',
    effectiveFrom,
    tasks: [
      { label: 'Bath time', iconKey: 'bathtub' },
      { label: 'Pajamas on', iconKey: 'bed' },
      { label: 'Brush teeth', iconKey: 'toothbrush' },
      { label: 'Story time', iconKey: 'open-book' },
    ],
  })
  return { morning, bedtime }
}

let designCursor = 0

/** Plays one past day: completes the tasks and, when earned, adds a claimed AVAILABLE sticker. */
function playDay(routine: FakeRoutine, plan: DayPlan, status: 'AVAILABLE' | 'UNCLAIMED' = 'AVAILABLE'): FakeSticker | null {
  const date = addDays(today(), -plan.ago)
  const count = plan.outcome === 'earned' ? routine.tasks.length : plan.outcome
  routine.tasks.slice(0, count).forEach((t) => seedCompletion(t.id, date))
  if (plan.outcome !== 'earned') return null
  const state = getState()
  const pool = state.designs.filter((d) => !d.isFallback && d.status === 'ACTIVE')
  const pick = (n: number) => pool[(designCursor + n * 5) % pool.length].id
  designCursor += 1
  const base = {
    childId: routine.childId,
    routineId: routine.id,
    chartDate: date,
    routineName: routine.name,
    routineIconKey: routine.iconKey,
  }
  if (status === 'UNCLAIMED') {
    return seedSticker({ ...base, status, designId: null, choices: [pick(0), pick(1), pick(2)] })
  }
  return seedSticker({ ...base, status, designId: pick(0) })
}

function seedDefault(): void {
  designCursor = 0
  const { jane, john } = seedFamily()
  const j = seedRoutines(jane)
  const o = seedRoutines(john)

  // Jane: a week of history, oldest first so the oldest stickers become the USED ones.
  const earned: FakeSticker[] = []
  const janeMorning: DayPlan[] = [
    { ago: 7, outcome: 'earned' },
    { ago: 6, outcome: 2 },
    { ago: 5, outcome: 'earned' },
    { ago: 4, outcome: 'earned' },
    { ago: 3, outcome: 1 },
    { ago: 2, outcome: 'earned' },
    { ago: 1, outcome: 'earned' },
  ]
  const janeBedtime: DayPlan[] = [
    { ago: 7, outcome: 'earned' },
    { ago: 6, outcome: 'earned' },
    { ago: 5, outcome: 0 },
    { ago: 4, outcome: 'earned' },
    { ago: 3, outcome: 'earned' },
    { ago: 2, outcome: 3 },
    { ago: 1, outcome: 'earned' },
  ]
  for (let ago = 7; ago >= 1; ago--) {
    for (const [routine, plans] of [
      [j.morning, janeMorning],
      [j.bedtime, janeBedtime],
    ] as const) {
      const plan = plans.find((p) => p.ago === ago)
      const sticker = plan ? playDay(routine, plan) : null
      if (sticker) earned.push(sticker)
    }
  }
  const used = earned.slice(0, 3)
  seedPrizeRequest({
    childId: jane.id,
    stickerIds: used.map((s) => s.id),
    status: 'COMPLETED',
    createdBy: 'PARENT',
    prizeText: 'Trip to the playground',
    createdAt: noonIso(addDays(today(), -4)),
  })

  // John: lighter history plus one pick waiting from yesterday.
  playDay(o.morning, { ago: 3, outcome: 'earned' })
  playDay(o.bedtime, { ago: 2, outcome: 'earned' })
  playDay(o.morning, { ago: 2, outcome: 2 })
  playDay(o.bedtime, { ago: 1, outcome: 1 })
  playDay(o.morning, { ago: 1, outcome: 'earned' }, 'UNCLAIMED')

  // Today: Jane's Morning has 2 of 4 done.
  j.morning.tasks.slice(0, 2).forEach((t) => seedCompletion(t.id, today()))
}

function janeMorning(): { child: FakeChild; routine: FakeRoutine } {
  const state = getState()
  const child = state.children.find((c) => c.name === 'Jane Doe')
  const routine = child && state.routines.find((r) => r.childId === child.id && r.name === 'Morning Routine')
  if (!child || !routine) throw new Error('default scenario missing Jane Doe')
  return { child, routine }
}

export function buildScenario(name: ScenarioName): void {
  resetState()
  if (name === 'fresh-install') return
  seedDefault()
  const state = getState()
  const { child, routine } = janeMorning()
  const t = today()
  switch (name) {
    case 'one-task-left':
      seedCompletion(routine.tasks[2].id, t)
      break
    case 'ready-to-finish':
      // Every task is done but I'm Done! has not been tapped, so there is no sticker yet (FR-6.6).
      routine.tasks.forEach((task) => seedCompletion(task.id, t))
      break
    case 'pick-waiting':
      routine.tasks.forEach((task) => seedCompletion(task.id, t))
      earnSticker(routine, t, 'TAPPED')
      break
    case 'auto-finished': {
      // Yesterday ended with the routine still Ready to finish, so the day's end earned an unclaimed sticker (FR-6.10).
      const yesterday = addDays(t, -1)
      const earned = state.stickers.find((s) => s.routineId === routine.id && s.chartDate === yesterday)
      if (earned) {
        const pool = state.designs.filter((d) => !d.isFallback && d.status === 'ACTIVE')
        Object.assign(earned, {
          status: 'UNCLAIMED',
          designId: null,
          claimedAt: null,
          choices: [pool[0].id, pool[5].id, pool[10].id],
          earnedAt: `${t}T00:00:00.000Z`,
          finishMode: 'AUTO',
        })
      }
      break
    }
    case 'empty-library':
      for (const d of state.designs) if (!d.isFallback) d.status = 'RETIRED'
      break
    case 'pending-request': {
      const available = state.stickers.filter((s) => s.childId === child.id && s.status === 'AVAILABLE').slice(0, 2)
      seedPrizeRequest({ childId: child.id, stickerIds: available.map((s) => s.id), status: 'PENDING', createdBy: 'CHILD' })
      break
    }
    case 'offline':
      state.offline = true
      break
    case 'default':
      break
  }
}
