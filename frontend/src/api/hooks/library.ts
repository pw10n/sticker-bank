import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { api, unwrap } from '../client'
import type { ApiError } from '../errors'
import { qk } from '../queryKeys'
import type { Category, CategoryInput, Design, DesignInput, DesignStatus, Library } from '../types'

export function useLibrary(filters: { q?: string; status?: DesignStatus; categoryId?: number }) {
  return useQuery<Library, ApiError>({
    queryKey: qk.parent.library(filters),
    queryFn: () => unwrap<Library>(api.GET('/api/parent/library/designs', { params: { query: filters } })),
    placeholderData: keepPreviousData,
  })
}

function invalidateLibrary(qc: QueryClient, everywhere: boolean) {
  void qc.invalidateQueries({ queryKey: ['parent', 'library'] })
  void qc.invalidateQueries({ queryKey: qk.parent.categories() })
  if (everywhere) {
    for (const root of ['book', 'chart', 'pick', 'sticker']) {
      void qc.invalidateQueries({ queryKey: [root] })
    }
  }
}

export function useCreateDesign() {
  const qc = useQueryClient()
  return useMutation<Design, ApiError, DesignInput>({
    mutationFn: (body) => unwrap<Design>(api.POST('/api/parent/library/designs', { body })),
    onSuccess: () => invalidateLibrary(qc, false),
  })
}

export function useUpdateDesign() {
  const qc = useQueryClient()
  return useMutation<Design, ApiError, { designId: number; input: DesignInput }>({
    mutationFn: ({ designId, input }) =>
      unwrap<Design>(
        api.PUT('/api/parent/library/designs/{designId}', { params: { path: { designId } }, body: input }),
      ),
    onSuccess: () => invalidateLibrary(qc, true),
  })
}

export function useDeleteDesign() {
  const qc = useQueryClient()
  return useMutation<void, ApiError, { designId: number }>({
    mutationFn: ({ designId }) =>
      unwrap<void>(api.DELETE('/api/parent/library/designs/{designId}', { params: { path: { designId } } })),
    onSuccess: () => invalidateLibrary(qc, true),
  })
}

export function useSetDesignStatus() {
  const qc = useQueryClient()
  return useMutation<Design, ApiError, { designId: number; status: DesignStatus }>({
    mutationFn: ({ designId, status }) =>
      unwrap<Design>(
        api.PUT('/api/parent/library/designs/{designId}/status', {
          params: { path: { designId } },
          body: { status },
        }),
      ),
    onSuccess: () => invalidateLibrary(qc, true),
  })
}

export function useCategories() {
  return useQuery<Category[], ApiError>({
    queryKey: qk.parent.categories(),
    queryFn: () => unwrap<Category[]>(api.GET('/api/parent/library/categories')),
  })
}

export function useCreateCategory() {
  const qc = useQueryClient()
  return useMutation<Category, ApiError, CategoryInput>({
    mutationFn: (body) => unwrap<Category>(api.POST('/api/parent/library/categories', { body })),
    onSuccess: () => invalidateLibrary(qc, false),
  })
}

export function useUpdateCategory() {
  const qc = useQueryClient()
  return useMutation<Category, ApiError, { categoryId: number; input: CategoryInput }>({
    mutationFn: ({ categoryId, input }) =>
      unwrap<Category>(
        api.PUT('/api/parent/library/categories/{categoryId}', {
          params: { path: { categoryId } },
          body: input,
        }),
      ),
    onSuccess: () => invalidateLibrary(qc, false),
  })
}

export function useDeleteCategory() {
  const qc = useQueryClient()
  return useMutation<void, ApiError, { categoryId: number }>({
    mutationFn: ({ categoryId }) =>
      unwrap<void>(
        api.DELETE('/api/parent/library/categories/{categoryId}', { params: { path: { categoryId } } }),
      ),
    onSuccess: () => invalidateLibrary(qc, false),
  })
}
