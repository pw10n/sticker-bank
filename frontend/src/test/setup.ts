import '@testing-library/jest-dom/vitest'
import 'fake-indexeddb/auto'
import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { resetFakeApi } from '../mocks/fakeApi'
import { server } from '../mocks/server'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))

afterEach(() => {
  cleanup()
  server.resetHandlers()
  resetFakeApi()
  try {
    localStorage.clear()
  } catch {
    /* ignore */
  }
})

afterAll(() => server.close())
