import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { motion } from 'motion/react'
import { useAllAvailableStickers, useCancelPrizeRequest, useCreatePrizeRequest, usePendingPrizeRequest } from '../../api/hooks'
import { isApiError } from '../../api/errors'
import { useCanWrite } from '../../app'
import { Artwork } from '../../artwork'
import { useSound } from '../../sound'
import { Button, ConfirmDialog, EmptyState, Spinner, useReducedMotion } from '../../ui'

const FOCUS = 'focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-ink'

export default function GetPrizeScreen() {
  const params = useParams()
  const childId = Number(params.childId)
  const pending = usePendingPrizeRequest(childId)

  let body
  if (pending.isPending) {
    body = (
      <div className="flex justify-center p-12" role="status" aria-label="Loading">
        <Spinner />
      </div>
    )
  } else if (pending.data) {
    body = <WaitingView childId={childId} />
  } else {
    body = <SelectionView childId={childId} />
  }
  return (
    <main data-testid="screen-get-prize-screen" className="min-h-full bg-paper p-4 text-ink">
      {body}
    </main>
  )
}

function WaitingView({ childId }: { childId: number }) {
  const pending = usePendingPrizeRequest(childId)
  const cancel = useCancelPrizeRequest(childId)
  const { play } = useSound()
  const [confirming, setConfirming] = useState(false)
  const canWrite = useCanWrite()
  const request = pending.data
  if (!request) return null
  return (
    <section className="mx-auto flex max-w-2xl flex-col items-center gap-4 text-center" aria-labelledby="waiting-title">
      <div aria-hidden="true" className="text-8xl">⏳</div>
      <h1 id="waiting-title" className="text-4xl font-extrabold">Waiting for a grown-up</h1>
      <p className="text-2xl font-bold">Show a grown-up to get your prize!</p>
      <p className="text-xl" aria-live="polite">
        {request.stickerCount} {request.stickerCount === 1 ? 'sticker' : 'stickers'}
      </p>
      <ul className="flex flex-wrap justify-center gap-3" aria-label="Your stickers">
        {request.stickers
          .filter((s) => !s.revoked)
          .map((s) => (
          <li key={s.stickerId} className="rounded-2xl bg-white p-2 shadow">
            <Artwork artKey={s.design.artworkKey} size={72} alt={s.design.name} />
          </li>
        ))}
      </ul>
      {cancel.isError && <p role="alert" className="text-lg">Oops! Please try again.</p>}
      <Button
        variant="secondary"
        size="lg"
        disabled={!canWrite}
        onClick={() => {
          play('tap')
          setConfirming(true)
        }}
      >
        Put my stickers back
      </Button>
      <ConfirmDialog
        open={confirming}
        title="Put your stickers back?"
        message="They will go back to your sticker book."
        confirmLabel="Yes, put them back"
        cancelLabel="Keep waiting"
        busy={cancel.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={() =>
          cancel.mutate(
            { requestId: request.id },
            {
              onSuccess: () => setConfirming(false),
              onError: () => {
                setConfirming(false)
                play('error')
              },
            },
          )
        }
      />
    </section>
  )
}

function SelectionView({ childId }: { childId: number }) {
  const stickers = useAllAvailableStickers(childId)
  const pending = usePendingPrizeRequest(childId)
  const create = useCreatePrizeRequest(childId)
  const { play } = useSound()
  const canWrite = useCanWrite()
  const reduced = useReducedMotion()
  const [selected, setSelected] = useState<number[]>([])
  const [message, setMessage] = useState<string | null>(null)

  if (stickers.isPending) {
    return (
      <div className="flex justify-center p-12" role="status" aria-label="Loading">
        <Spinner />
      </div>
    )
  }
  const items = stickers.data?.items ?? []
  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-2xl">
        <EmptyState
          icon="⭐"
          title="Finish a routine to earn stickers!"
          action={
            <Link
              to={`/c/${childId}`}
              className={`inline-flex min-h-14 items-center rounded-full bg-sunshine px-6 text-lg font-bold ${FOCUS}`}
            >
              Back to my chart
            </Link>
          }
        />
      </div>
    )
  }

  const valid = new Set(items.map((i) => i.stickerId))
  const picked = selected.filter((id) => valid.has(id))
  const count = picked.length

  const toggle = (id: number) => {
    if (!canWrite) return
    play('tap')
    setMessage(null)
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
  }

  const submit = () => {
    setMessage(null)
    create.mutate(
      { stickerIds: picked },
      {
        onSuccess: () => {
          play('fanfare')
          setMessage('Show a grown-up to get your prize!')
        },
        onError: (e) => {
          if (isApiError(e, 'PENDING_REQUEST_EXISTS')) {
            void pending.refetch()
          } else if (isApiError(e, 'STICKER_NOT_AVAILABLE')) {
            setSelected([])
            setMessage('Some stickers changed — please pick again')
            void stickers.refetch()
          } else {
            play('error')
            setMessage('Oops! Something went wrong. Please try again.')
          }
        },
      },
    )
  }

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-4" aria-labelledby="prize-title">
      <h1 id="prize-title" className="text-center text-3xl font-extrabold">Get a prize!</h1>
      <p className="text-center text-lg">Tap the stickers you want to trade.</p>
      <div className="flex flex-col items-center gap-1" aria-live="polite" aria-atomic="true" data-testid="prize-counter">
        <span className="text-7xl font-extrabold" style={{ color: 'var(--child-color)' }}>{count}</span>
        <span className="text-xl font-bold">{count === 1 ? 'sticker picked' : 'stickers picked'}</span>
      </div>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-3">
        {items.map((s) => {
          const on = picked.includes(s.stickerId)
          return (
            <li key={s.stickerId}>
              <motion.button
                type="button"
                aria-pressed={on}
                disabled={!canWrite}
                onClick={() => toggle(s.stickerId)}
                animate={reduced ? undefined : { y: on ? -8 : 0, scale: on ? 1.06 : 1 }}
                className={`relative flex min-h-24 min-w-24 w-full flex-col items-center gap-1 rounded-2xl border-4 bg-white p-2 disabled:opacity-60 ${FOCUS} ${
                  on ? 'shadow-xl' : 'border-transparent shadow'
                }`}
                style={on ? { borderColor: 'var(--child-color)', backgroundColor: 'var(--child-color-soft)' } : undefined}
              >
                {on && (
                  <span
                    aria-hidden="true"
                    className="absolute -right-2 -top-2 flex h-9 w-9 items-center justify-center rounded-full text-xl font-extrabold text-white"
                    style={{ backgroundColor: 'var(--child-color)' }}
                  >
                    ✓
                  </span>
                )}
                <Artwork artKey={s.design.artworkKey} size={72} decorative />
                <span className="text-sm font-bold">{s.design.name}</span>
              </motion.button>
            </li>
          )
        })}
      </ul>
      {message && (
        <p role="status" className="text-center text-xl font-bold">
          {message}
        </p>
      )}
      <div className="flex flex-col items-center gap-3">
        <Button size="xl" disabled={count === 0 || !canWrite} loading={create.isPending} onClick={submit}>
          Get my prize!
        </Button>
        <Button variant="ghost" size="md" disabled={count === 0} onClick={() => setSelected([])}>
          Clear
        </Button>
      </div>
    </section>
  )
}
