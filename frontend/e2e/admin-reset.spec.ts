import { expect, test } from '@playwright/test'
import { holdParentMode, isCompose } from './helpers'

test.skip(!isCompose, 'needs real backend + MySQL')

/**
 * Manual step (cannot be automated from the browser): before this test, the Admin resets the PIN
 * against the database used by compose.yaml, for example:
 *
 *     mysql --host "$DB_HOST" --port "$DB_PORT" --user "$DB_USER" --password "$DB_PASSWORD" "$DB_NAME" \
 *       -e "CALL reset_parent_pin('Test Admin')"
 *
 * The connection values come from the environment (see env.example); nothing is hardcoded here.
 * Set E2E_PIN_RESET_DONE=1 once that has been done.
 */
test('after an Admin PIN reset, Parent Mode asks for a new PIN', async ({ page }) => {
  test.skip(process.env.E2E_PIN_RESET_DONE !== '1', 'run CALL reset_parent_pin(...) first, then set E2E_PIN_RESET_DONE=1')

  await page.goto('/')
  await page.getByRole('button', { name: /Jane|Who|Parent Mode/ }).first().waitFor()
  await holdParentMode(page)
  await expect(page.getByRole('heading', { name: 'Choose a 4-digit PIN' })).toBeVisible()
})
