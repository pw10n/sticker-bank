import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end suite (TDD 13).
 *
 * E2E_TARGET=mock (default): starts the Vite dev server in mock mode; the fake API lives in the
 *   browser page and is seeded from `?scenario=<name>`.
 * E2E_TARGET=compose: runs against the real app + MySQL from compose.yaml (no web server is started).
 *
 * URLs come from the environment only: E2E_BASE_URL overrides the default of either target.
 */
const compose = process.env.E2E_TARGET === 'compose'
const MOCK_PORT = 5174

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? (compose ? 'http://localhost:8080' : `http://localhost:${MOCK_PORT}`),
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'iPad', use: { ...devices['iPad (gen 7)'], hasTouch: true } },
    { name: 'Phone', use: { ...devices['Pixel 7'], hasTouch: true } },
  ],
  webServer: compose
    ? undefined
    : {
        command: `npm run dev:mock -- --port ${MOCK_PORT} --strictPort`,
        url: process.env.E2E_BASE_URL ?? `http://localhost:${MOCK_PORT}`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
})
