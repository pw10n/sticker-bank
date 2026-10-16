import { expect, test, type Locator, type Page } from '@playwright/test'
import { enterParentMode, isCompose, localDate, openJaneChart, openJaneHistory } from './helpers'

test.skip(isCompose, 'relies on mock scenarios (seeded stickers)')

const nav = (page: Page) => page.getByRole('navigation', { name: 'Parent Mode' })

/** Opens the given day in the (already open) History screen, paging back to its week if needed. */
async function openDay(page: Page, daysAgo: number): Promise<Locator> {
  const day = page.getByTestId(`day-${localDate(daysAgo)}`)
  for (let i = 0; i < 4 && (await day.count()) === 0; i++) {
    await page.getByRole('button', { name: 'Previous week' }).click()
    await page.waitForTimeout(300)
  }
  await day.getByRole('button', { name: /^Open / }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByRole('listitem', { name: 'Morning Routine', exact: true })).toBeVisible()
  return sheet
}

/** Opens the most recent day (within two weeks) where a routine's sticker chip reads `status`. */
async function openDayWithStatus(page: Page, status: string, startAgo = 0): Promise<{ sheet: Locator; daysAgo: number }> {
  for (let daysAgo = startAgo; daysAgo < 15; daysAgo++) {
    const sheet = await openDay(page, daysAgo)
    await expect(sheet.getByRole('heading', { name: 'Morning Routine' })).toBeVisible()
    await page.waitForTimeout(200)
    const chip = sheet.getByTestId('sticker-status').filter({ hasText: new RegExp(`^${status}$`) })
    if ((await chip.count()) > 0) return { sheet, daysAgo }
    await sheet.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  }
  throw new Error(`no day with a ${status} sticker`)
}

/** The routine card (inside the day sheet) holding a sticker chip with `status`. */
function routineWith(sheet: Locator, status: string): Locator {
  return sheet
    .getByRole('listitem')
    .filter({ has: sheet.page().getByTestId('sticker-status').filter({ hasText: new RegExp(`^${status}$`) }) })
    .filter({ has: sheet.page().getByRole('heading') })
    .last()
}

test("revoke today, the child re-taps, taps I'm Done! and gets a new pick", async ({ page }) => {
  await openJaneChart(page, 'pick-waiting')
  await enterParentMode(page)
  await openJaneHistory(page)

  const sheet = await openDay(page, 0)
  const morning = sheet.getByRole('listitem', { name: 'Morning Routine', exact: true })
  await expect(morning.getByTestId('sticker-status')).toHaveText('Unclaimed')

  await morning.getByRole('button', { name: 'Brush teeth (done) Uncheck' }).click()
  const confirm = page.getByRole('dialog', { name: 'Remove this sticker?' })
  await expect(confirm).toBeVisible()
  await expect(confirm).toContainText('Not picked yet')
  await confirm.getByRole('textbox', { name: 'Note (optional)' }).fill('Tapped by mistake')
  await confirm.getByRole('button', { name: 'Remove sticker' }).click()

  await expect(sheet.getByRole('status')).toContainText('Sticker removed.')
  await expect(morning).toContainText('3 of 4 done')
  const log = sheet.getByRole('region', { name: 'Removed stickers' })
  await expect(log).toContainText('Brush teeth unchecked')
  await expect(log).toContainText('unpicked sticker removed')
  await expect(log).toContainText('Tapped by mistake')

  await sheet.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Exit Parent Mode' }).click()
  const chartMorning = page.getByRole('region', { name: 'Morning Routine' })
  if (!(await chartMorning.isVisible())) await page.getByRole('button', { name: 'Jane Doe' }).first().click()
  await expect(chartMorning).toContainText('3 of 4 done')
  const show = chartMorning.getByRole('button', { name: 'Show' })
  if (await show.count()) await show.click()
  await chartMorning.getByRole('button', { name: /Brush teeth/, pressed: false }).click()

  // The re-check only makes the routine Ready to finish again (FR-12.5). I'm Done! earns the new sticker.
  const done = chartMorning.getByRole('button', { name: /I'm Done!/ })
  await expect(done).toBeVisible()
  await page.waitForTimeout(700) // the button ignores taps right after it appears
  await done.click()

  await expect(page.getByRole('heading', { name: 'Pick your sticker!' })).toBeVisible({ timeout: 20_000 })
  const choices = page.getByRole('main').getByRole('button').filter({ hasNotText: 'Not now' })
  await expect(choices).toHaveCount(3)
})

test('revoking Pending stickers shrinks and then cancels the prize request', async ({ page }) => {
  await openJaneChart(page, 'pending-request')
  await enterParentMode(page)
  await openJaneHistory(page)

  // First Pending sticker: the request keeps the other one.
  const first = await openDayWithStatus(page, 'Pending')
  let routine = routineWith(first.sheet, 'Pending')
  await routine.getByRole('button', { name: /\(done\) Uncheck$/ }).first().click()
  let confirm = page.getByRole('dialog', { name: 'Remove this sticker?' })
  await expect(confirm).toContainText('It will be taken out')
  await expect(confirm).not.toContainText('cancelled')
  await confirm.getByRole('button', { name: 'Remove sticker' }).click()
  await expect(first.sheet.getByRole('status')).toContainText('Sticker removed.')
  await first.sheet.getByRole('button', { name: 'Close', exact: true }).click()

  await nav(page).getByRole('link', { name: /Prizes/ }).click()
  await expect(page.getByRole('heading', { name: 'Prize requests' })).toBeVisible()
  await expect(page.getByText('1 sticker', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('2 stickers', { exact: true })).toHaveCount(0)

  // The other Pending sticker is the last one: removing it cancels the request.
  await nav(page).getByRole('link', { name: 'Children' }).click()
  await openJaneHistoryLink(page)
  const second = await openDayWithStatus(page, 'Pending')
  routine = routineWith(second.sheet, 'Pending')
  await routine.getByRole('button', { name: /\(done\) Uncheck$/ }).first().click()
  confirm = page.getByRole('dialog', { name: 'Remove this sticker?' })
  await expect(confirm).toContainText('and the request will be cancelled')
  await confirm.getByRole('button', { name: 'Remove sticker' }).click()
  await expect(second.sheet.getByRole('status')).toContainText('Sticker removed.')
  await expect(second.sheet.getByRole('region', { name: 'Removed stickers' })).toContainText('Prize request cancelled')
  await second.sheet.getByRole('button', { name: 'Close', exact: true }).click()

  await nav(page).getByRole('link', { name: /Prizes/ }).click()
  await page.getByRole('tab', { name: 'History' }).click()
  await expect(page.getByRole('tabpanel', { name: 'History' })).toBeVisible()
  await expect(page.getByText('Cancelled: stickers removed')).toBeVisible()
  await expect(page.getByText('(revoked)').first()).toBeVisible()
  await expect(page.locator('s').first()).toBeVisible()
})

async function openJaneHistoryLink(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'History for Jane Doe' }).click()
  await expect(page.getByRole('heading', { name: "Jane Doe's history" })).toBeVisible()
  await expect(page.locator('[data-testid^="day-"]').first()).toBeVisible()
}

test('a Used sticker can not be removed', async ({ page }) => {
  await openJaneChart(page, 'default')
  await enterParentMode(page)
  await openJaneHistory(page)

  const { sheet } = await openDayWithStatus(page, 'Used')
  const routine = routineWith(sheet, 'Used')
  await expect(routine).toContainText("This sticker was already spent on a prize, so it can't be taken back.")
  const done = routine.locator('button[aria-pressed="true"]')
  expect(await done.count()).toBeGreaterThan(0)
  for (let i = 0; i < (await done.count()); i++) await expect(done.nth(i)).toBeDisabled()
})

test('Child Mode can not uncheck a finished routine', async ({ page }) => {
  await openJaneChart(page, 'pick-waiting')
  const morning = page.getByRole('region', { name: 'Morning Routine' })
  await expect(morning).toContainText('4 of 4 done')
  const show = morning.getByRole('button', { name: 'Show' })
  if (await show.count()) await show.click()
  const tiles = morning.getByRole('listitem').getByRole('button')
  await expect(tiles).toHaveCount(4)
  for (let i = 0; i < 4; i++) await expect(tiles.nth(i)).toBeDisabled()
})
