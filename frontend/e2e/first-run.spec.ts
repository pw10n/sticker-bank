import { expect, test } from '@playwright/test'
import { enterPin, isCompose } from './helpers'

test.skip(isCompose, 'relies on the mock fresh-install scenario')

test('first run: welcome, create a PIN, add the first child', async ({ page }) => {
  await page.goto('/?scenario=fresh-install')

  await expect(page.getByRole('heading', { name: 'Welcome to Sticker Bank' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Choose a 4-digit PIN' })).toBeVisible()
  await enterPin(page, '2468')
  await expect(page.getByRole('heading', { name: 'Enter it again' })).toBeVisible()
  await enterPin(page, '2468')

  await expect(page.getByRole('heading', { name: 'Add a child' })).toBeVisible()
  await page.getByLabel('Name', { exact: true }).fill('Jane Doe')
  await page.getByRole('group', { name: 'Picture' }).getByRole('button').first().click()
  await page.getByRole('group', { name: 'Theme color' }).getByRole('button').nth(1).click()
  await page.getByRole('button', { name: 'Save' }).click()

  await expect(page).toHaveURL(/\/parent\/children\/\d+\/routines$/)
  await expect(page.getByRole('heading', { name: "Jane Doe's routines" })).toBeVisible()
})
