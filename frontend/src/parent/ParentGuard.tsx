import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Outlet, useNavigate } from 'react-router'
import { useBootstrap, useParentSession, useUnlock } from '../api/hooks'
import { isApiError } from '../api/errors'
import { qk } from '../api/queryKeys'
import { useMode } from '../app'
import { describePinError } from '../child/pinpad/pinErrors'
import { PinPad } from '../child/pinpad/PinPad'
import { Spinner } from '../ui'
import { CreatePinFlow } from '../welcome/CreatePinFlow'

/** UX gate only: the server enforces authentication (TDD 9.1). */
export default function ParentGuard() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { enterParentMode } = useMode()
  const session = useParentSession()
  const bootstrap = useBootstrap()
  const unlock = useUnlock()
  const [error, setError] = useState<string | undefined>()
  const [lockedSeconds, setLockedSeconds] = useState(0)
  const [lockRound, setLockRound] = useState(0)
  const [needsCreate, setNeedsCreate] = useState(false)
  const [forceUnlock, setForceUnlock] = useState(false)

  const unlocked = session.data !== undefined
  useEffect(() => {
    if (unlocked) enterParentMode()
  }, [unlocked, enterParentMode])

  // Session expired while inside Parent Mode: re-check the session so the PIN pad returns.
  useEffect(() => {
    const sessionKey = JSON.stringify(qk.parent.session())
    return qc.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated' || event.action.type !== 'error') return
      if (JSON.stringify(event.query.queryKey) === sessionKey) return
      if (isApiError(event.action.error, 'PARENT_SESSION_REQUIRED')) {
        void qc.resetQueries({ queryKey: qk.parent.session() })
      }
    })
  }, [qc])

  if (unlocked) return <Outlet />

  if (session.isPending || (bootstrap.isPending && !forceUnlock)) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-paper">
        <Spinner label="Loading" />
      </main>
    )
  }

  const backToKids = () => navigate('/')
  const showCreate = !forceUnlock && (bootstrap.data?.setupRequired === true || needsCreate)

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-paper p-6 text-ink [@media(max-height:520px)]:flex-row [@media(max-height:520px)]:gap-4 [@media(max-height:520px)]:p-2">
      {showCreate ? (
        <CreatePinFlow
          onDone={() => {}}
          onAlreadySet={() => {
            setNeedsCreate(false)
            setForceUnlock(true)
          }}
          onCancel={backToKids}
          cancelLabel="Back to kids"
        />
      ) : (
        <PinPad
          key={lockRound}
          title="Grown-ups only"
          subtitle="Enter your PIN"
          error={error}
          busy={unlock.isPending}
          lockedSeconds={lockedSeconds}
          onCancel={backToKids}
          cancelLabel="Back to kids"
          onComplete={(pin) => {
            unlock.mutate(
              { pin },
              {
                onSuccess: () => {
                  setError(undefined)
                  setLockedSeconds(0)
                },
                onError: (e) => {
                  if (isApiError(e, 'PIN_NOT_SET')) {
                    setNeedsCreate(true)
                    return
                  }
                  const info = describePinError(e)
                  setError(info.message)
                  setLockedSeconds(info.lockedSeconds ?? 0)
                  setLockRound((r) => r + 1)
                },
              },
            )
          }}
        />
      )}
      <p className="max-w-sm text-center text-sm [@media(max-height:520px)]:max-w-[11rem] [@media(max-height:520px)]:text-left [@media(max-height:520px)]:text-xs">
        Forgot your PIN? Ask the person who set up Sticker Bank (the Admin) to reset it.
      </p>
    </main>
  )
}
