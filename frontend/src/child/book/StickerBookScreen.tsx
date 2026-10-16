import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { useBootstrap, useSticker, useStickerBook } from '../../api/hooks'
import type { BookSticker } from '../../api/types'
import { Artwork } from '../../artwork'
import { Button, Card, EmptyState, Sheet, Spinner } from '../../ui'

function shiftDay(iso: string, delta: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10)
}

function dateLabel(date: string, today: string | undefined): string {
  if (today && date === today) return 'Today'
  if (today && date === shiftDay(today, -1)) return 'Yesterday'
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

function longDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function Tile({ icon, label, value, testId }: { icon: string; label: string; value: number; testId: string }) {
  return (
    <div
      data-testid={testId}
      className="flex min-w-[120px] flex-1 flex-col items-center gap-1 rounded-[2rem] border-4 border-ink/25 bg-white p-3 text-center"
    >
      <span aria-hidden="true" className="text-4xl">
        {icon}
      </span>
      <span className="text-4xl font-bold" style={{ color: 'var(--child-color)' }}>
        {value}
      </span>
      <span className="text-lg font-bold">{label}</span>
    </div>
  )
}

function StickerSheetBody({ sticker }: { sticker: BookSticker }) {
  const used = sticker.status === 'USED'
  const detail = useSticker(used ? sticker.stickerId : null)
  return (
    <div className="flex flex-col items-center gap-3 text-center text-lg">
      <Artwork artKey={sticker.design.artworkKey} size={160} alt={sticker.design.name} />
      {sticker.routineName && <p>Earned for {sticker.routineName}</p>}
      <p>Earned on {longDate(sticker.chartDate)}</p>
      {sticker.status === 'PENDING' && <p className="font-bold">⏳ Waiting for a prize</p>}
      {used && detail.isPending && <Spinner />}
      {used && detail.data?.prize && (
        <div className="rounded-2xl bg-white p-3">
          <p className="font-bold">Used for: {detail.data.prize.prizeText}</p>
          {detail.data.prize.completedAt && (
            <p>on {longDate(detail.data.prize.completedAt.slice(0, 10))}</p>
          )}
        </div>
      )}
      {used && detail.data && !detail.data.prize && <p>This sticker was used.</p>}
    </div>
  )
}

function StickerTile({ sticker, onOpen }: { sticker: BookSticker; onOpen(): void }) {
  const used = sticker.status === 'USED'
  const pending = sticker.status === 'PENDING'
  return (
    <button
      type="button"
      data-testid="book-sticker"
      data-status={sticker.status}
      onClick={onOpen}
      className="relative flex min-h-[96px] min-w-[96px] flex-col items-center gap-1 rounded-[1.5rem] border-4 border-ink/25 bg-white p-3 text-ink touch-manipulation focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-ink"
    >
      <span className={`flex flex-col items-center gap-1 ${used ? 'opacity-50 grayscale' : ''}`}>
        <Artwork artKey={sticker.design.artworkKey} size={96} alt="" decorative />
        <span className="text-base font-bold">{sticker.design.name}</span>
        {sticker.routineName && (
          <span className="flex items-center gap-1 text-sm">
            {sticker.routineIconKey && <Artwork artKey={sticker.routineIconKey} size={20} decorative />}
            {sticker.routineName}
          </span>
        )}
      </span>
      {used && (
        <span
          data-testid="used-mark"
          className="absolute right-1 top-1 rounded-full border-2 border-ink bg-paper px-2 text-sm font-bold"
        >
          ✓ used
        </span>
      )}
      {pending && (
        <span
          data-testid="pending-mark"
          role="img"
          aria-label="waiting"
          className="absolute right-1 top-1 rounded-full border-2 border-ink bg-sunshine px-2 text-xl"
        >
          ⏳
        </span>
      )}
    </button>
  )
}

export default function StickerBookScreen() {
  const params = useParams()
  const childId = Number(params.childId)
  const [filter, setFilter] = useState<'all' | 'available'>('all')
  const [open, setOpen] = useState<BookSticker | null>(null)
  const bootstrap = useBootstrap()
  const book = useStickerBook(childId, filter === 'available' ? 'AVAILABLE' : undefined)
  const today = bootstrap.data?.today

  const counts = book.data?.pages[0]?.counts
  const groups = useMemo(() => {
    const items = book.data?.pages.flatMap((p) => p.items) ?? []
    const out: { date: string; items: BookSticker[] }[] = []
    for (const s of items) {
      const last = out[out.length - 1]
      if (last && last.date === s.chartDate) last.items.push(s)
      else out.push({ date: s.chartDate, items: [s] })
    }
    return out
  }, [book.data])

  const filterBtn = (value: 'all' | 'available', label: string) => (
    <button
      type="button"
      aria-pressed={filter === value}
      onClick={() => setFilter(value)}
      style={filter === value ? { backgroundColor: 'var(--child-color)' } : undefined}
      className={`min-h-[56px] rounded-full border-4 px-6 text-xl font-bold text-ink touch-manipulation ${
        filter === value ? 'border-ink' : 'border-ink/25 bg-white'
      }`}
    >
      {label}
    </button>
  )

  return (
    <main data-testid="screen-sticker-book-screen" className="min-h-dvh bg-paper px-4 pb-10 pt-6 text-ink">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-4xl font-bold">My Sticker Book</h1>
          <Link to={`/c/${childId}`} className="min-h-[56px] rounded-full border-4 border-ink/25 bg-white px-5 py-3 text-lg font-bold">
            Back to my chart
          </Link>
        </div>

        {counts && (
          <>
            <div className="flex flex-wrap gap-4">
              <Tile testId="count-available" icon="⭐" label="Available" value={counts.available} />
              <Tile testId="count-pending" icon="⏳" label="Waiting" value={counts.pending} />
              <Tile testId="count-used" icon="🎁" label="Used" value={counts.used} />
              <Tile testId="count-total" icon="🏆" label="Total earned" value={counts.totalEarned} />
            </div>
            {counts.unclaimed > 0 && (
              <Link
                to={`/c/${childId}`}
                data-testid="unclaimed-callout"
                className="rounded-[2rem] border-4 border-ink bg-sunshine p-4 text-center text-2xl font-bold"
              >
                🎉 {counts.unclaimed} {counts.unclaimed === 1 ? 'sticker' : 'stickers'} to pick!
              </Link>
            )}
          </>
        )}

        <div className="flex flex-wrap gap-3" role="group" aria-label="Filter stickers">
          {filterBtn('all', 'All')}
          {filterBtn('available', 'Ready to spend')}
        </div>

        {book.isPending ? (
          <div className="flex justify-center p-8">
            <Spinner />
          </div>
        ) : groups.length === 0 ? (
          <EmptyState icon="🌟" title="No stickers yet — finish a routine to earn one!" />
        ) : (
          groups.map((g) => (
            <section key={g.date} className="flex flex-col gap-3">
              <h2 className="text-2xl font-bold">{dateLabel(g.date, today)}</h2>
              <Card>
                <div className="flex flex-wrap gap-4">
                  {g.items.map((s) => (
                    <StickerTile key={s.stickerId} sticker={s} onOpen={() => setOpen(s)} />
                  ))}
                </div>
              </Card>
            </section>
          ))
        )}

        {book.hasNextPage && (
          <Button size="xl" loading={book.isFetchingNextPage} onClick={() => void book.fetchNextPage()}>
            Show more
          </Button>
        )}
      </div>

      <Sheet
        open={open !== null}
        onClose={() => setOpen(null)}
        title={open?.design.name ?? ''}
        footer={<Button onClick={() => setOpen(null)}>Close</Button>}
      >
        {open && <StickerSheetBody sticker={open} />}
      </Sheet>
    </main>
  )
}
