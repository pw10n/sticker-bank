import { getArtwork } from './catalog'

export interface ArtworkProps {
  artKey: string
  size: number
  alt?: string
  decorative?: boolean
  className?: string
}

export function Artwork({ artKey, size, alt, decorative, className }: ArtworkProps) {
  const entry = getArtwork(artKey)
  if (entry?.file) {
    return (
      <img
        src={entry.file}
        width={size}
        height={size}
        alt={decorative ? '' : (alt ?? entry.name)}
        draggable={false}
        className={className}
      />
    )
  }
  const glyph = entry?.emoji || '⭐'
  const label = decorative ? undefined : (alt ?? entry?.name ?? 'Picture')
  return (
    <span
      role={decorative ? undefined : 'img'}
      aria-label={label}
      aria-hidden={decorative ? true : undefined}
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        fontSize: Math.round(size * 0.8),
        lineHeight: 1,
      }}
    >
      {glyph}
    </span>
  )
}
