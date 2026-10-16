import { expect, test } from '@playwright/test'
import { isCompose, openJaneChart } from './helpers'

// In compose mode a reload proves the three choices are persisted on the server (BR-6).
// In mock mode the fake API is re-seeded from `?scenario=pick-waiting` on every full load with a
// seeded RNG, so the same three names come back: this checks the screen survives a reload and
// shows a stable, deterministic offer.
test('a reload in the middle of a pick keeps the same three choices', async ({ page }) => {
  await openJaneChart(page, 'pick-waiting')

  await page.getByRole('link', { name: 'Pick your sticker!' }).first().click()
  await expect(page.getByRole('heading', { name: 'Pick your sticker!' })).toBeVisible()

  const choiceNames = async () => {
    const choices = page.getByRole('main').getByRole('button').filter({ hasNotText: 'Not now' })
    await expect(choices).toHaveCount(3)
    return (await choices.allInnerTexts()).map((t) => t.trim())
  }
  const before = await choiceNames()
  expect(new Set(before).size).toBe(3)

  if (isCompose) {
    await page.reload()
  } else {
    // In-app navigation dropped `?scenario=`, so re-load the same pick URL with the scenario again.
    await page.goto(`${new URL(page.url()).pathname}?scenario=pick-waiting`)
  }
  await expect(page.getByRole('heading', { name: 'Pick your sticker!' })).toBeVisible()
  expect(await choiceNames()).toEqual(before)
})
