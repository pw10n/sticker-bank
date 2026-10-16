import { buildScenario } from './scenarios'
import { getState, type FakeState } from './fakeState'

export type ScenarioName =
  | 'default'
  | 'fresh-install'
  | 'one-task-left'
  | 'ready-to-finish'
  | 'pick-waiting'
  | 'auto-finished'
  | 'empty-library'
  | 'pending-request'
  | 'offline'

export const SCENARIO_NAMES: readonly ScenarioName[] = [
  'default',
  'fresh-install',
  'one-task-left',
  'ready-to-finish',
  'pick-waiting',
  'auto-finished',
  'empty-library',
  'pending-request',
  'offline',
]

export function isScenarioName(value: string | null | undefined): value is ScenarioName {
  return (SCENARIO_NAMES as readonly string[]).includes(value ?? '')
}

/** Demo PIN of the seeded scenarios (mock mode only). */
export { DEMO_PIN } from './scenarios'

/** Rebuilds the in-memory backend from a named scenario (deterministic, seeded RNG). */
export function resetFakeApi(scenario: ScenarioName = 'default'): void {
  buildScenario(scenario)
}

/** Overrides "today" (YYYY-MM-DD); `null` goes back to the real local date. */
export function setFakeToday(date: string | null): void {
  getState().todayOverride = date
}

/** Starts a test in Parent Mode (or locks it). */
export function setFakeParentSession(active: boolean): void {
  getState().parentSession = active
}

/** Read-only view of the fake backend, for test assertions. */
export function getFakeState(): Readonly<FakeState> {
  return getState()
}

// Tests that never call resetFakeApi() still get the default scenario.
resetFakeApi('default')
