import { Artwork } from '../../artwork'
import { stickerWord } from './format'
import type { Child, PrizeRequest } from '../../api/types'

export function ChildChip({ name, child }: { name: string; child?: Child }) {
  return (
    <span className="inline-flex items-center gap-2 text-xl font-bold">
      {child && <Artwork artKey={child.avatarKey} size={40} decorative />}
      {name}
    </span>
  )
}

export function StickerThumbs({ request, showRevoked = false }: { request: PrizeRequest; showRevoked?: boolean }) {
  const stickers = showRevoked ? request.stickers : request.stickers.filter((s) => !s.revoked)
  return (
    <div>
      <ul className="flex flex-wrap gap-2" aria-label="Stickers">
        {stickers.map((s) => (
          <li key={s.stickerId} className="flex flex-col items-center">
            <span className={s.revoked ? 'opacity-50' : undefined}>
              <Artwork artKey={s.design.artworkKey} size={40} alt={s.design.name} />
            </span>
            {s.revoked && (
              <span className="text-sm font-bold">
                <s>{s.design.name}</s> (revoked)
              </span>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-1 text-base font-bold">{stickerWord(request.stickerCount)}</p>
    </div>
  )
}
