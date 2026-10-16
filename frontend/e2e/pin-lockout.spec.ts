import { expect, test } from '@playwright/test'
import { enterPin, holdParentMode, isCompose, openJaneChart } from './helpers'

test.skip(isCompose, 'relies on the mock default scenario and demo PIN')

test('five wrong PINs lock the keypad with a countdown', async ({ page }) => {
  await openJaneChart(page, 'default')
  await holdParentMode(page)
  await expect(page.getByRole('heading', { name: 'Grown-ups only' })).toBeVisible()

  await enterPin(page, '9999')
  await expect(page.getByText('4 tries left')).toBeVisible()
  await enterPin(page, '9999')
  await expect(page.getByText('3 tries left')).toBeVisible()
  await enterPin(page, '9999')
  await expect(page.getByText('2 tries left')).toBeVisible()
  await enterPin(page, '9999')
  await expect(page.getByText('1 try left')).toBeVisible()
  await enterPin(page, '9999')

  await expect(page.getByText(/Try again in \d+:\d\d/)).toBeVisible()
  const keypad = page.getByRole('group', { name: 'PIN keypad' })
  await expect(keypad.getByRole('button', { name: '1', exact: true })).toBeDisabled()
  await expect(keypad.getByRole('button', { name: '0', exact: true })).toBeDisabled()
})
