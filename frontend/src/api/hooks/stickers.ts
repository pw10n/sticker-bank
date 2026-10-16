import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, unwrap } from '../client'
import type { ApiError } from '../errors'
import { qk } from '../queryKeys'
import type { BookSticker, StickerBookPage, StickerCounts, StickerDetail, StickerPick, StickerStatus } from '../types'

export function useStickerPick(stickerId: number) {
  return useQuery({
    queryKey: qk.pick(stickerId),
    queryFn: () =>
      unwrap<StickerPick>(api.GET('/api/stickers/{stickerId}/pick', { params: { path: { stickerId } } })),
  })
}

export function useClaimPick(childId: number) {
  const qc = useQueryClient()
  return useMutation<BookSticker, ApiError, { stickerId: number; designId: number }>({
    mutationFn: ({ stickerId, designId }) =>
      unwrap<BookSticker>(
        api.POST('/api/stickers/{stickerId}/pick', { params: { path: { stickerId } }, body: { designId } }),
      ),
    onSuccess: (_result, { stickerId, designId }) => {
      const prev = qc.getQueryData<StickerPick>(qk.pick(stickerId))
      if (prev) {
        const claimed = prev.choices.find((c) => c.designId === designId) ?? _result.design
        qc.setQueryData<StickerPick>(qk.pick(stickerId), {
          ...prev,
          status: 'AVAILABLE',
          choices: [],
          claimed,
        })
      }
      void qc.invalidateQueries({ queryKey: ['chart', childId] })
      void qc.invalidateQueries({ queryKey: ['book', childId] })
      void qc.invalidateQueries({ queryKey: qk.sticker(stickerId) })
    },
  })
}

export function useStickerBook(childId: number, status?: StickerStatus) {
  return useInfiniteQuery({
    queryKey: qk.book(childId, status),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      unwrap<StickerBookPage>(
        api.GET('/api/children/{childId}/stickers', {
          params: { path: { childId }, query: { status: status === 'UNCLAIMED' || status === 'REVOKED' ? undefined : status, cursor: pageParam } },
        }),
      ),
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  })
}

export function useAllAvailableStickers(childId: number) {
  return useQuery({
    queryKey: [...qk.book(childId, 'AVAILABLE'), 'all'] as const,
    queryFn: async (): Promise<{ counts: StickerCounts; items: BookSticker[] }> => {
      const items: BookSticker[] = []
      let cursor: string | undefined
      for (;;) {
        const page: StickerBookPage = await unwrap<StickerBookPage>(
          api.GET('/api/children/{childId}/stickers', {
            params: { path: { childId }, query: { status: 'AVAILABLE', limit: 200, cursor } },
          }),
        )
        items.push(...page.items)
        if (!page.nextCursor) return { counts: page.counts, items }
        cursor = page.nextCursor
      }
    },
  })
}

export function useSticker(stickerId: number | null) {
  return useQuery({
    queryKey: qk.sticker(stickerId ?? -1),
    queryFn: () =>
      unwrap<StickerDetail>(
        api.GET('/api/stickers/{stickerId}', { params: { path: { stickerId: stickerId as number } } }),
      ),
    enabled: stickerId !== null,
  })
}
