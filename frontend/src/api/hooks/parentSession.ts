import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, unwrap } from '../client'
import type { ApiError } from '../errors'
import { qk } from '../queryKeys'
import type { ParentSession, Settings, SettingsUpdateRequest } from '../types'

export function useParentSession(opts?: { enabled?: boolean }) {
  return useQuery<ParentSession, ApiError>({
    queryKey: qk.parent.session(),
    queryFn: () => unwrap<ParentSession>(api.GET('/api/parent/session')),
    enabled: opts?.enabled ?? true,
    retry: false,
    staleTime: 0,
  })
}

export function useCreatePin() {
  const qc = useQueryClient()
  return useMutation<ParentSession, ApiError, { pin: string; timeZone: string }>({
    mutationFn: (body) => unwrap<ParentSession>(api.POST('/api/parent/pin', { body })),
    onSuccess: (session) => {
      qc.setQueryData(qk.parent.session(), session)
      void qc.invalidateQueries({ queryKey: qk.bootstrap() })
    },
  })
}

export function useUnlock() {
  const qc = useQueryClient()
  return useMutation<ParentSession, ApiError, { pin: string }>({
    mutationFn: (body) => unwrap<ParentSession>(api.POST('/api/parent/session', { body })),
    onSuccess: (session) => {
      qc.setQueryData(qk.parent.session(), session)
    },
  })
}

export function useChangePin() {
  return useMutation<void, ApiError, { currentPin: string; newPin: string }>({
    mutationFn: (body) => unwrap<void>(api.PUT('/api/parent/pin', { body })),
  })
}

export function useTouchSession() {
  const qc = useQueryClient()
  return useMutation<ParentSession, ApiError, void>({
    mutationFn: () => unwrap<ParentSession>(api.POST('/api/parent/session/touch')),
    onSuccess: (session) => {
      qc.setQueryData(qk.parent.session(), session)
    },
  })
}

export function useEndSession() {
  const qc = useQueryClient()
  return useMutation<void, ApiError, void>({
    mutationFn: () => unwrap<void>(api.DELETE('/api/parent/session')),
    onSuccess: () => {
      qc.removeQueries({ queryKey: qk.parent.all })
    },
  })
}

export function useSettings() {
  return useQuery<Settings, ApiError>({
    queryKey: qk.parent.settings(),
    queryFn: () => unwrap<Settings>(api.GET('/api/parent/settings')),
  })
}

export function useUpdateSettings() {
  const qc = useQueryClient()
  return useMutation<Settings, ApiError, SettingsUpdateRequest>({
    mutationFn: (body) => unwrap<Settings>(api.PUT('/api/parent/settings', { body })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.parent.settings() })
      void qc.invalidateQueries({ queryKey: qk.bootstrap() })
    },
  })
}
