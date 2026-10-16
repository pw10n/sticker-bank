import { isScenarioName, resetFakeApi, type ScenarioName } from './fakeApi'
import { handlers } from './handlers'

function scenarioFromLocation(): ScenarioName {
  const requested = new URLSearchParams(window.location.search).get('scenario')
  return isScenarioName(requested) ? requested : 'default'
}

export async function startMockWorker(): Promise<void> {
  const scenario = scenarioFromLocation()
  resetFakeApi(scenario)
  const { setupWorker } = await import('msw/browser')
  const worker = setupWorker(...handlers)
  await worker.start({
    onUnhandledRequest: 'bypass',
    serviceWorker: { url: '/mockServiceWorker.js' },
  })
  console.info(`[mock api] scenario=${scenario}`)
}
