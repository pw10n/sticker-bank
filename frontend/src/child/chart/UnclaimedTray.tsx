import { Link } from 'react-router'
import type { UnclaimedSticker } from '../../api/types'
import { Artwork } from '../../artwork'
import { friendlyDate } from './friendlyDate'

export function UnclaimedTray({ items, childId, today }: { items: UnclaimedSticker[]; childId: number; today: string }) {
  if (items.length === 0) return null
  return (
    <section
      aria-label="Stickers to pick"
      className="flex flex-col gap-4 rounded-[2rem] border-4 border-ink bg-sunshine/60 p-5 shadow-[0_6px_0_rgba(27,27,47,0.18)]"
    >
      <h2 className="text-2xl font-bold">
        <span aria-hidden="true">🎉 </span>Stickers waiting for you!
      </h2>
      <ul className="flex flex-col gap-4">
        {items.map((u) => (
          <li key={u.stickerId}>
            <Link
              to={`/c/${childId}/pick/${u.stickerId}`}
              className="flex min-h-[72px] touch-manipulation items-center gap-4 rounded-full border-4 border-ink bg-white px-5 py-2 text-[1.4rem] font-bold text-ink focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-ink"
            >
              <Artwork artKey={u.routineIconKey ?? 'star'} size={56} decorative />
              <span className="flex flex-col leading-tight">
                <span>Pick your sticker!</span>
                <span className="text-lg font-semibold">
                  {u.routineName} · {friendlyDate(u.chartDate, today)}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
