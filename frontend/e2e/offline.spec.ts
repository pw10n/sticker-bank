import { expect, test } from '@playwright/test'
import { isCompose } from './helpers'

test.skip(isCompose, 'relies on the mock offline scenario')

test('an unreachable server shows the friendly waiting message', async ({ page }) => {
  await page.goto('/?scenario=offline')
  await expect(page.getByText('Waiting for Wi-Fi…')).toBeVisible()
})
