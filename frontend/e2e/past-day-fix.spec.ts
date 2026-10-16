import { expect, test } from '@playwright/test'
import { enterParentMode, isCompose, openJaneChart } from './helpers'

test.skip(isCompose, 'relies on the mock default scenario (seeded missed days)')

test('a parent completes a missed past day and defers the sticker pick', async ({ page }) => {
  await openJaneChart(page, 'default')
  await enterParentMode(page)

  await page.getByRole('navigation', { name: 'Parent Mode' }).getByRole('link', { name: 'Children' }).click()
  await page.getByRole('link', { name: 'History for Jane Doe' }).click()
  await expect(page.getByRole('heading', { name: "Jane Doe's history" })).toBeVisible()

  // Find a week that shows a MISSED day (the seed has missed days within the last week).
  const missedDay = page.getByRole('listitem').filter({ hasText: /Missed/ }).and(page.locator('[data-testid^="day-"]'))
  for (let i = 0; i < 3 && (await missedDay.count()) === 0; i++) {
    await page.getByRole('button', { name: 'Previous week' }).click()
    await page.waitForTimeout(300)
  }
  await expect(missedDay.first()).toBeVisible()
  await missedDay.first().getByRole('button', { name: /^Open / }).click()

  const dialog = page.getByRole('dialog')
  const firstMissed = dialog.getByRole('listitem').filter({ hasText: 'Missed' }).first()
  await expect(firstMissed).toBeVisible()
  const routineName = (await firstMissed.getByRole('heading').innerText()).trim()
  // Locate by accessible name (stable even after the state badge changes from Missed to Earned).
  const routine = dialog.getByRole('listitem', { name: routineName, exact: true })
  const tasks = routine.locator('ul button[aria-pressed]')
  const total = await tasks.count()
  for (let i = 0; i < total; i++) {
    const task = tasks.nth(i)
    if ((await task.getAttribute('aria-pressed')) === 'true') continue
    await task.click() // auto-waits until the previous toggle settled (buttons are disabled while saving)
    await expect(task).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 })
  }

  await expect(dialog.getByRole('status')).toContainText(`Jane Doe earned a sticker for ${routineName}!`, {
    timeout: 10_000,
  })
  await dialog.getByRole('button', { name: /^Later/ }).click()
  await expect(dialog.getByRole('status')).toHaveCount(0)
  await expect(dialog.getByText('Sticker earned', { exact: false }).first()).toBeVisible()
})
