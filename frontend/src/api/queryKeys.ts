import type { DesignStatus, PrizeRequestStatus, StickerStatus } from './types'

export const qk = {
  bootstrap: () => ['bootstrap'] as const,
  chart: (childId: number, date: string) => ['chart', childId, date] as const,
  book: (childId: number, status?: StickerStatus) => ['book', childId, status ?? 'ALL'] as const,
  pick: (stickerId: number) => ['pick', stickerId] as const,
  sticker: (stickerId: number) => ['sticker', stickerId] as const,
  pendingRequest: (childId: number) => ['pendingRequest', childId] as const,
  parent: {
    all: ['parent'] as const,
    session: () => ['parent', 'session'] as const,
    settings: () => ['parent', 'settings'] as const,
    children: () => ['parent', 'children'] as const,
    routines: (childId: number) => ['parent', 'routines', childId] as const,
    routine: (id: number) => ['parent', 'routine', id] as const,
    history: (childId: number, from: string, to: string) => ['parent', 'history', childId, from, to] as const,
    library: (filters: { q?: string; status?: DesignStatus; categoryId?: number }) =>
      ['parent', 'library', filters] as const,
    categories: () => ['parent', 'categories'] as const,
    prizeRequests: (filters: { status?: PrizeRequestStatus[]; childId?: number }) =>
      ['parent', 'prizeRequests', filters] as const,
  },
}

/** Query-key roots persisted to IndexedDB for offline use. */
export const PERSISTED_ROOT_KEYS = ['bootstrap', 'chart', 'book'] as const
