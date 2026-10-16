import { expect, type Locator, type Page } from '@playwright/test'

/** Demo PIN of the mock scenarios (mock mode only). */
export const DEMO_PIN = '1234'

export const isCompose = process.env.E2E_TARGET === 'compose'

/** Taps the digits on the on-screen PIN pad. */
export async function enterPin(page: Page, pin: string): Promise<void> {
  const keypad = page.getByRole('group', { name: 'PIN keypad' })
  for (const digit of pin) {
    await keypad.getByRole('button', { name: digit, exact: true }).click()
  }
}

/** Press-and-hold (1 s) on the Parent Mode button, using pointer events as a finger would. */
export async function holdParentMode(page: Page): Promise<void> {
  const button = page.getByRole('button', { name: 'Parent Mode', exact: true })
  await holdButton(button)
}

export async function holdButton(button: Locator): Promise<void> {
  await button.dispatchEvent('pointerdown')
  await button.page().waitForTimeout(1300)
  // The hold already navigated away, so the button may be gone: releasing is best effort.
  await button.dispatchEvent('pointerup', undefined, { timeout: 1000 }).catch(() => undefined)
}

/** Holds Parent Mode and unlocks with the demo PIN. */
export async function enterParentMode(page: Page): Promise<void> {
  await holdParentMode(page)
  await expect(page.getByRole('heading', { name: 'Grown-ups only' })).toBeVisible()
  await enterPin(page, DEMO_PIN)
  await expect(page.getByRole('navigation', { name: 'Parent Mode' })).toBeVisible()
}

/** Opens the app on Jane Doe's chart (the child picker is skipped once a child is remembered). */
export async function openJaneChart(page: Page, scenario: string): Promise<void> {
  await page.goto(`/?scenario=${scenario}`)
  await page.getByRole('button', { name: 'Jane Doe' }).first().click()
  await expect(page.getByRole('button', { name: 'Parent Mode', exact: true })).toBeVisible()
}

/** Parent Mode -> Children -> History for Jane Doe (call after `openJaneChart` + `enterParentMode`). */
export async function openJaneHistory(page: Page): Promise<void> {
  await page.getByRole('navigation', { name: 'Parent Mode' }).getByRole('link', { name: 'Children' }).click()
  await page.getByRole('link', { name: 'History for Jane Doe' }).click()
  await expect(page.getByRole('heading', { name: "Jane Doe's history" })).toBeVisible()
  await expect(page.locator('[data-testid^="day-"]').first()).toBeVisible()
}

/** Local calendar date (YYYY-MM-DD) `daysAgo` days before the browser-side today. */
export function localDate(daysAgo: number): string {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
