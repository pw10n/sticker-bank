import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import type { Query } from '@tanstack/react-query'
import { del, get, set } from 'idb-keyval'
import { PERSISTED_ROOT_KEYS } from '../api/queryKeys'
import { SEVEN_DAYS_MS } from './queryClient'

export const PERSIST_KEY = 'sticker-bank-query-cache'
export const PERSIST_MAX_AGE = SEVEN_DAYS_MS

/** Only successful queries under the allow-listed roots are persisted. Parent data never is. */
export function shouldDehydrateQuery(query: Pick<Query, 'queryKey' | 'state'>): boolean {
  const root = query.queryKey[0]
  return (
    query.state.status === 'success' &&
    typeof root === 'string' &&
    (PERSISTED_ROOT_KEYS as readonly string[]).includes(root)
  )
}

export const persister = createAsyncStoragePersister({
  key: PERSIST_KEY,
  storage: {
    getItem: (key) => get<string>(key).then((v) => v ?? null),
    setItem: (key, value) => set(key, value),
    removeItem: (key) => del(key),
  },
})
