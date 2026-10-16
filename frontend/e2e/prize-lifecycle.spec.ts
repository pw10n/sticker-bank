import { expect, test } from '@playwright/test'
import { enterParentMode, isCompose, openJaneChart } from './helpers'

test.skip(isCompose, 'relies on the mock default scenario')

test('prize request lifecycle: ask, give, history, used stickers', async ({ page }) => {
  await openJaneChart(page, 'default')

  // Child asks for a prize with two stickers.
  await page.getByRole('link', { name: 'Get a Prize' }).click()
  await expect(page.getByRole('heading', { name: 'Get a prize!' })).toBeVisible()
  const tiles = page.getByRole('main').getByRole('button', { pressed: false })
  await tiles.nth(0).click()
  await tiles.nth(0).click()
  await expect(page.getByTestId('prize-counter')).toContainText('2')
  await page.getByRole('button', { name: 'Get my prize!' }).click()
  await expect(page.getByRole('heading', { name: 'Waiting for a grown-up' })).toBeVisible()

  // The grown-up gives the prize.
  await enterParentMode(page)
  await page.getByRole('navigation', { name: 'Parent Mode' }).getByRole('link', { name: /Prizes/ }).click()
  await expect(page.getByRole('heading', { name: 'Prize requests' })).toBeVisible()
  await expect(page.getByText('Started by Jane Doe')).toBeVisible()
  await page.getByRole('button', { name: 'Give prize', exact: true }).click()
  const sheet = page.getByRole('dialog')
  await sheet.getByLabel('What prize did you give?').fill('Ice cream after dinner')
  await sheet.getByRole('button', { name: 'Give prize', exact: true }).click()
  await expect(page.getByText('Stickers marked as used')).toBeVisible()

  await page.getByRole('tab', { name: 'History' }).click()
  await expect(page.getByText('Ice cream after dinner')).toBeVisible()
  await expect(page.getByText('Prize given').first()).toBeVisible()

  // Back in Child Mode the two stickers are used.
  await page.getByRole('button', { name: 'Exit Parent Mode' }).click()
  await page.getByRole('link', { name: 'Sticker Book' }).click()
  await expect(page.getByRole('heading', { name: 'My Sticker Book' })).toBeVisible()
  // 3 stickers are used in the seed, plus the 2 just spent.
  await expect(page.getByTestId('count-used')).toContainText('5')
  await expect(page.getByTestId('used-mark').first()).toBeVisible()
})
