import { expect, test } from '@playwright/test'
import { isCompose, openJaneChart } from './helpers'

test.skip(isCompose, 'relies on the mock one-task-left scenario')

test('earn a sticker, pick it, and find it in the Sticker Book', async ({ page }) => {
  await openJaneChart(page, 'one-task-left')

  const morning = page.getByRole('region', { name: 'Morning Routine' })
  await expect(morning.getByText('3 of 4 done')).toBeVisible()
  const last = morning.getByRole('button', { name: /Shoes on/, pressed: false })
  await last.click()

  // Celebration, then the pick screen with three choices.
  await expect(page.getByRole('heading', { name: 'Pick your sticker!' })).toBeVisible({ timeout: 20_000 })
  const choices = page.getByRole('main').getByRole('button').filter({ hasNotText: 'Not now' })
  await expect(choices).toHaveCount(3)
  const name = ((await choices.first().innerText()) ?? '').trim()
  expect(name).not.toBe('')
  await choices.first().click()

  await expect(page.getByRole('heading', { name: "It's in your Sticker Book!" })).toBeVisible()
  await page.getByRole('button', { name: 'See my Sticker Book' }).click()

  await expect(page.getByRole('heading', { name: 'My Sticker Book' })).toBeVisible()
  const available = Number(await page.getByTestId('count-available').locator('span').nth(1).innerText())
  expect(available).toBeGreaterThanOrEqual(1)
  await page.getByRole('button', { name: 'Ready to spend' }).click()
  await expect(page.getByTestId('book-sticker').filter({ hasText: name }).first()).toBeVisible()
})
