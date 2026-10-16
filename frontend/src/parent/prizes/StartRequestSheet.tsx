import { useState } from 'react'
import { Artwork } from '../../artwork'
import { isApiError } from '../../api/errors'
import { useAllAvailableStickers, useChildren, useCreatePrizeRequest, usePendingPrizeRequest } from '../../api/hooks'
import { Button, Select, Sheet, Spinner } from '../../ui'
import { stickerWord } from './format'

function Picker({ childId, childName, onDone }: { childId: number; childName: string; onDone(): void }) {
  const pending = usePendingPrizeRequest(childId)
  const stickers = useAllAvailableStickers(childId)
  const create = useCreatePrizeRequest(childId)
  const [selected, setSelected] = useState<number[]>([])
  const [message, setMessage] = useState<string | null>(null)

  if (pending.isLoading || stickers.isLoading) return <Spinner />
  if (pending.data) {
    return (
      <p role="status" className="text-lg font-bold">
        {childName} already has a request waiting — finish or cancel it first
      </p>
    )
  }
  const items = stickers.data?.items ?? []
  if (items.length === 0) {
    return <p role="status" className="text-lg">{childName} has no stickers to spend yet</p>
  }
  const toggle = (id: number) =>
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))

  const submit = () => {
    setMessage(null)
    create.mutate(
      { stickerIds: selected },
      {
        onSuccess: onDone,
        onError: (e) => {
          if (isApiError(e, 'PENDING_REQUEST_EXISTS')) {
            setMessage(`${childName} already has a request waiting — finish or cancel it first`)
          } else if (isApiError(e, 'STICKER_NOT_AVAILABLE')) {
            setMessage('Some of those stickers are no longer available. Please choose again.')
            setSelected([])
          } else {
            setMessage('Something went wrong. Please try again.')
          }
          void pending.refetch()
          void stickers.refetch()
        },
      },
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-base font-bold">
        {stickerWord(items.length)} available · {selected.length} selected
      </p>
      <ul className="grid grid-cols-4 gap-2 sm:grid-cols-5">
        {items.map((s) => {
          const on = selected.includes(s.stickerId)
          return (
            <li key={s.stickerId}>
              <button
                type="button"
                aria-pressed={on}
                aria-label={`${s.design.name}, ${s.chartDate}`}
                onClick={() => toggle(s.stickerId)}
                className={`relative flex min-h-14 w-full items-center justify-center rounded-2xl border-2 p-1 focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-ink ${
                  on ? 'border-ink bg-sunshine' : 'border-ink/20 bg-white'
                }`}
              >
                <Artwork artKey={s.design.artworkKey} size={44} decorative />
                {on && (
                  <span aria-hidden="true" className="absolute right-1 top-0 text-lg font-bold">
                    ✓
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
      {message && (
        <p role="alert" className="font-bold">
          {message}
        </p>
      )}
      <Button onClick={submit} disabled={selected.length < 1} loading={create.isPending}>
        Create request
      </Button>
    </div>
  )
}

export function StartRequestSheet({ onClose, onCreated }: { onClose(): void; onCreated(): void }) {
  const children = useChildren()
  const [childId, setChildId] = useState<number | null>(null)
  const list = children.data ?? []
  const chosen = list.find((c) => c.id === childId)
  return (
    <Sheet open onClose={onClose} title="Start a request" footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      <div className="flex flex-col gap-4">
        <Select
          label="Which child?"
          value={childId ?? ''}
          onChange={(e) => setChildId(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">Choose a child</option>
          {list.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        {chosen && <Picker key={chosen.id} childId={chosen.id} childName={chosen.name} onDone={onCreated} />}
      </div>
    </Sheet>
  )
}
