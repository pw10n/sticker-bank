import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from '../api/client'
import { qk } from '../api/queryKeys'
import { ModeContext, type Mode } from './modeContext'


export function ModeProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<Mode>('child')

  useEffect(() => {
    document.body.classList.toggle('child-mode', mode === 'child')
    return () => document.body.classList.remove('child-mode')
  }, [mode])

  const enterParentMode = useCallback(() => setMode('parent'), [])
  const exitParentMode = useCallback(async () => {
    try {
      await api.DELETE('/api/parent/session')
    } catch {
      /* ignore: the local lock matters more than the server round trip */
    }
    queryClient.removeQueries({ queryKey: qk.parent.all })
    setMode('child')
  }, [queryClient])

  const value = useMemo(() => ({ mode, enterParentMode, exitParentMode }), [mode, enterParentMode, exitParentMode])
  return <ModeContext.Provider value={value}>{children}</ModeContext.Provider>
}
