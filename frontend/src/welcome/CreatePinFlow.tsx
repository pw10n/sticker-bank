import { useState } from 'react'
import { useCreatePin } from '../api/hooks'
import { isApiError } from '../api/errors'
import { useMode } from '../app'
import { PinPad } from '../child/pinpad/PinPad'
import { Button } from '../ui'

export interface CreatePinFlowProps {
  onDone(): void
  /** Called when another device set the PIN first; switch to unlock. */
  onAlreadySet?(): void
  onCancel?(): void
  cancelLabel?: string
}

/** FR-8.5: choose a 4-digit PIN, then confirm it. */
export function CreatePinFlow({ onDone, onAlreadySet, onCancel, cancelLabel }: CreatePinFlowProps) {
  const createPin = useCreatePin()
  const { enterParentMode } = useMode()
  const [first, setFirst] = useState<string | null>(null)
  const [error, setError] = useState<string | undefined>()
  const [round, setRound] = useState(0)
  const [alreadySet, setAlreadySet] = useState(false)

  if (alreadySet) {
    return (
      <div role="alert" className="mx-auto flex max-w-sm flex-col items-center gap-4 rounded-[2rem] bg-white p-6 text-center text-ink">
        <h1 className="text-2xl font-bold">A PIN was just set on another device</h1>
        <p>Use that PIN to get in.</p>
        <Button size="lg" onClick={() => onAlreadySet?.()}>
          Enter your PIN
        </Button>
      </div>
    )
  }

  const handle = (pin: string) => {
    if (first === null) {
      setError(undefined)
      setFirst(pin)
      return
    }
    if (pin !== first) {
      setFirst(null)
      setRound((r) => r + 1)
      setError('Those didn’t match — let’s try again')
      return
    }
    createPin.mutate(
      { pin, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      {
        onSuccess: () => {
          enterParentMode()
          onDone()
        },
        onError: (e) => {
          setFirst(null)
          setRound((r) => r + 1)
          if (isApiError(e, 'PIN_ALREADY_SET')) setAlreadySet(true)
          else setError('Something went wrong. Please try again.')
        },
      },
    )
  }

  return (
    <PinPad
      key={`${round}-${first === null ? 'first' : 'confirm'}`}
      title={first === null ? 'Choose a 4-digit PIN' : 'Enter it again'}
      subtitle={first === null ? 'You’ll use it to open Parent Mode.' : undefined}
      onComplete={handle}
      error={error}
      busy={createPin.isPending}
      onCancel={onCancel}
      cancelLabel={cancelLabel}
    />
  )
}
