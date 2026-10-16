import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { isApiError } from '../../api/errors'
import {
  useChildren,
  useCompletePrizeRequest,
  useEditPrizeRequest,
  useParentCancelPrizeRequest,
  useParentPrizeRequests,
} from '../../api/hooks'
import type { Child, PrizeRequest } from '../../api/types'
import { Button, Card, ConfirmDialog, EmptyState, PageHeader, Select, Spinner } from '../../ui'
import { PrizeFormSheet } from './PrizeForm'
import { StartRequestSheet } from './StartRequestSheet'
import { formatWhen, stickerWord } from './format'
import { ChildChip, StickerThumbs } from './shared'

const WAITING = ['PENDING'] as const
const HISTORY = ['COMPLETED', 'CANCELLED', 'REVERSED'] as const
const STATUS_LABEL = { COMPLETED: 'Prize given', CANCELLED: 'Cancelled', REVERSED: 'Reversed', PENDING: 'Waiting' } as const

type Tab = 'waiting' | 'history'

export default function PrizeRequestsScreen() {
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get('tab') === 'history' ? 'history' : 'waiting'
  const [message, setMessage] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const children = useChildren()
  const childById = new Map<number, Child>((children.data ?? []).map((c) => [c.id, c]))

  const setTab = (t: Tab) => {
    setMessage(null)
    setParams(t === 'history' ? { tab: 'history' } : {}, { replace: true })
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      const next: Tab = tab === 'waiting' ? 'history' : 'waiting'
      setTab(next)
      document.getElementById(`prize-tab-${next}`)?.focus()
    }
  }

  return (
    <main data-testid="screen-prize-requests-screen" className="mx-auto w-full max-w-3xl p-4">
      <PageHeader
        title="Prize requests"
        actions={<Button onClick={() => setStarting(true)}>Start a request</Button>}
      />
      <div role="tablist" aria-label="Prize requests" className="mb-4 flex gap-2" onKeyDown={onKey}>
        {(['waiting', 'history'] as const).map((t) => (
          <button
            key={t}
            id={`prize-tab-${t}`}
            role="tab"
            type="button"
            aria-selected={tab === t}
            aria-controls="prize-tabpanel"
            tabIndex={tab === t ? 0 : -1}
            onClick={() => setTab(t)}
            className={`min-h-11 flex-1 rounded-2xl border-2 border-ink/30 px-4 text-lg font-bold focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-ink ${
              tab === t ? 'bg-sunshine' : 'bg-white'
            }`}
          >
            {t === 'waiting' ? 'Waiting' : 'History'}
          </button>
        ))}
      </div>
      {message && (
        <p role="status" className="mb-4 rounded-2xl bg-mint p-3 text-lg font-bold">
          {message}
        </p>
      )}
      <div id="prize-tabpanel" role="tabpanel" aria-labelledby={`prize-tab-${tab}`}>
        {tab === 'waiting' ? (
          <WaitingList childById={childById} onMessage={setMessage} />
        ) : (
          <HistoryList children={children.data ?? []} childById={childById} onMessage={setMessage} />
        )}
      </div>
      {starting && (
        <StartRequestSheet
          onClose={() => setStarting(false)}
          onCreated={() => {
            setStarting(false)
            setTab('waiting')
            setMessage('Request started')
          }}
        />
      )}
    </main>
  )
}

function WaitingList({ childById, onMessage }: { childById: Map<number, Child>; onMessage(m: string): void }) {
  const q = useParentPrizeRequests({ status: [...WAITING] })
  const complete = useCompletePrizeRequest()
  const cancel = useParentCancelPrizeRequest()
  const [giving, setGiving] = useState<PrizeRequest | null>(null)
  const [cancelling, setCancelling] = useState<PrizeRequest | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handled = () => {
    void q.refetch()
    return 'This request was already handled on another device'
  }

  if (q.isLoading) return <Spinner />
  if (q.isError) return <p role="alert">Could not load requests.</p>
  const items = q.data?.pages.flatMap((p) => p.items) ?? []
  if (items.length === 0) return <EmptyState icon="🎁" title="No prize requests waiting" />

  return (
    <>
      <ul className="flex flex-col gap-3">
        {items.map((r) => (
          <li key={r.id}>
            <Card>
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <ChildChip name={r.childName} child={childById.get(r.childId)} />
                  <span className="text-base">{formatWhen(r.createdAt)}</span>
                </div>
                <StickerThumbs request={r} />
                <p className="text-base">
                  {r.createdBy === 'CHILD' ? `Started by ${r.childName}` : 'Started by a grown-up'}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => {
                      setError(null)
                      setGiving(r)
                    }}
                  >
                    Give prize
                  </Button>
                  <Button variant="secondary" onClick={() => setCancelling(r)}>
                    Cancel request
                  </Button>
                </div>
              </div>
            </Card>
          </li>
        ))}
      </ul>
      {giving && (
        <PrizeFormSheet
          title={`Give prize to ${giving.childName}`}
          submitLabel="Give prize"
          busy={complete.isPending}
          error={error}
          onClose={() => setGiving(null)}
          onSubmit={(v) =>
            complete.mutate(
              { requestId: giving.id, ...v },
              {
                onSuccess: () => {
                  setGiving(null)
                  onMessage('Stickers marked as used')
                },
                onError: (e) => {
                  if (isApiError(e, 'REQUEST_NOT_PENDING')) {
                    setGiving(null)
                    onMessage(handled())
                  } else setError('Something went wrong. Please try again.')
                },
              },
            )
          }
        />
      )}
      <ConfirmDialog
        open={cancelling !== null}
        title="Cancel request"
        message={
          cancelling && `Cancel this request? The ${cancelling.stickerCount} stickers go back to ${cancelling.childName}.`
        }
        confirmLabel="Cancel request"
        cancelLabel="Keep it"
        danger
        busy={cancel.isPending}
        onCancel={() => setCancelling(null)}
        onConfirm={() => {
          if (!cancelling) return
          cancel.mutate(
            { requestId: cancelling.id, childId: cancelling.childId },
            {
              onSuccess: () => {
                setCancelling(null)
                onMessage('Request cancelled. The stickers are back.')
              },
              onError: (e) => {
                setCancelling(null)
                onMessage(isApiError(e, 'REQUEST_NOT_PENDING') ? handled() : 'Something went wrong. Please try again.')
              },
            },
          )
        }}
      />
    </>
  )
}

function HistoryList({
  children,
  childById,
  onMessage,
}: {
  children: Child[]
  childById: Map<number, Child>
  onMessage(m: string): void
}) {
  const [filter, setFilter] = useState<number | undefined>(undefined)
  const q = useParentPrizeRequests({ status: [...HISTORY], childId: filter })
  const edit = useEditPrizeRequest()
  const [editing, setEditing] = useState<PrizeRequest | null>(null)
  const [error, setError] = useState<string | null>(null)
  const items = q.data?.pages.flatMap((p) => p.items) ?? []

  return (
    <div className="flex flex-col gap-3">
      <Select
        label="Child"
        value={filter ?? ''}
        onChange={(e) => setFilter(e.target.value ? Number(e.target.value) : undefined)}
      >
        <option value="">All children</option>
        {children.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>
      {q.isLoading ? (
        <Spinner />
      ) : q.isError ? (
        <p role="alert">Could not load history.</p>
      ) : items.length === 0 ? (
        <EmptyState icon="📜" title="No history yet" />
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((r) => (
            <li key={r.id}>
              <Card>
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <ChildChip name={r.childName} child={childById.get(r.childId)} />
                    <span className="inline-flex items-center gap-1 rounded-full border-2 border-ink px-3 py-1 text-sm font-bold">
                      <span aria-hidden="true">{r.status === 'COMPLETED' ? '🎁' : r.status === 'CANCELLED' ? '✖' : '↩'}</span>
                      {r.status === 'CANCELLED' && r.cancelReason === 'ALL_STICKERS_REVOKED'
                        ? 'Cancelled: stickers removed'
                        : STATUS_LABEL[r.status]}
                    </span>
                  </div>
                  <p className="text-base">
                    {formatWhen(r.completedAt ?? r.cancelledAt ?? r.reversedAt ?? r.createdAt)} · {stickerWord(r.stickerCount)}
                  </p>
                  <StickerThumbs request={r} showRevoked />
                  {r.prizeText && <p className="text-lg font-bold">{r.prizeText}</p>}
                  {r.note && <p className="text-base">{r.note}</p>}
                  {r.status === 'COMPLETED' && (
                    <div>
                      <Button
                        variant="secondary"
                        aria-label={`Edit prize for ${r.childName}`}
                        onClick={() => {
                          setError(null)
                          setEditing(r)
                        }}
                      >
                        Edit
                      </Button>
                    </div>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {q.hasNextPage && (
        <Button variant="secondary" onClick={() => void q.fetchNextPage()} loading={q.isFetchingNextPage}>
          Load more
        </Button>
      )}
      {editing && (
        <PrizeFormSheet
          title="Edit prize"
          submitLabel="Save"
          initial={{ prizeText: editing.prizeText ?? '', note: editing.note ?? '' }}
          busy={edit.isPending}
          error={error}
          onClose={() => setEditing(null)}
          onSubmit={(v) =>
            edit.mutate(
              { requestId: editing.id, ...v },
              {
                onSuccess: () => {
                  setEditing(null)
                  onMessage('Prize updated')
                },
                onError: (e) => {
                  if (isApiError(e, 'REQUEST_NOT_COMPLETED')) {
                    setEditing(null)
                    onMessage('This prize can no longer be edited')
                    void q.refetch()
                  } else setError('Something went wrong. Please try again.')
                },
              },
            )
          }
        />
      )}
    </div>
  )
}
