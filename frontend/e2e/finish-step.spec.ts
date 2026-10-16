import { expect, test } from '@playwright/test'
import { enterParentMode, isCompose, localDate, openJaneChart, openJaneHistory } from './helpers'

test.skip(isCompose, 'relies on mock scenarios (ready-to-finish, auto-finished)')

test("a routine that is ready to finish shows I'm Done! and no sticker (FR-6.6)", async ({ page }) => {
  await openJaneChart(page, 'ready-to-finish')

  const morning = page.getByRole('region', { name: 'Morning Routine' })
  await expect(morning.getByRole('button', { name: /I'm Done!/ })).toBeVisible()
  await expect(morning.getByText(/All tasks done/)).toBeVisible()
  // not finished: no sticker, no locked tiles
  await expect(morning.getByText(/Finished!/)).toHaveCount(0)
  await expect(morning.getByRole('link', { name: /Pick your sticker!/ })).toHaveCount(0)
  for (const name of ['Brush teeth', 'Get dressed', 'Eat breakfast', 'Shoes on']) {
    await expect(morning.getByRole('button', { name, pressed: true })).toBeEnabled()
  }
})

test('a sticker the day\'s end earned waits in the tray and can be picked (FR-6.10)', async ({ page }) => {
  await openJaneChart(page, 'auto-finished')

  const tray = page.getByRole('region', { name: 'Stickers to pick' })
  await expect(tray).toBeVisible()
  await expect(tray).toContainText('Yesterday')
  await tray.getByRole('link', { name: /Pick your sticker!/ }).click()

  await expect(page.getByRole('heading', { name: 'Pick your sticker!' })).toBeVisible()
  const choices = page.getByRole('main').getByRole('button').filter({ hasNotText: 'Not now' })
  await expect(choices).toHaveCount(3)
  await choices.first().click()
  await expect(page.getByRole('heading', { name: "It's in your Sticker Book!" })).toBeVisible()
})

test('the parent sees which sticker was finished automatically (FR-6.11)', async ({ page }) => {
  await openJaneChart(page, 'auto-finished')
  await enterParentMode(page)
  await openJaneHistory(page)

  // the calendar marks the day
  await expect(page.getByTestId('auto-finished-mark').first()).toBeVisible()

  // and the day sheet marks the sticker, so the parent can check the tasks and remove it if they were not done
  const day = page.getByTestId(`day-${localDate(1)}`)
  for (let i = 0; i < 2 && (await day.count()) === 0; i++) {
    await page.getByRole('button', { name: 'Previous week' }).click()
    await page.waitForTimeout(300)
  }
  await day.getByRole('button', { name: /^Open / }).click()
  const sheet = page.getByRole('dialog')
  const morning = sheet.getByRole('listitem', { name: 'Morning Routine', exact: true })
  await expect(morning.getByTestId('sticker-auto-finished')).toHaveText('Finished automatically')
  await expect(morning.getByTestId('sticker-status')).toHaveText('Unclaimed')
})
