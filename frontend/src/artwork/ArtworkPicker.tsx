import { useId, useMemo, useState } from 'react'
import { Artwork } from './Artwork'
import { artworkForUse, type ArtworkUse } from './catalog'

export interface ArtworkPickerProps {
  use: ArtworkUse
  value: string | null
  onChange(key: string): void
  label: string
}

export function ArtworkPicker({ use, value, onChange, label }: ArtworkPickerProps) {
  const [query, setQuery] = useState('')
  const searchId = useId()
  const items = useMemo(() => artworkForUse(use), [use])
  const q = query.trim().toLowerCase()
  const filtered = q
    ? items.filter(
        (e) => e.name.toLowerCase().includes(q) || e.tags.some((t) => t.toLowerCase().includes(q)),
      )
    : items

  return (
    <div role="group" aria-label={label} className="flex flex-col gap-3">
      <label htmlFor={searchId} className="text-sm font-semibold">
        Search {label}
      </label>
      <input
        id={searchId}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search"
        className="min-h-12 rounded-xl border-2 border-black/20 px-3 text-base"
      />
      {filtered.length === 0 ? (
        <p role="status">No pictures found</p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(5rem,1fr))] gap-2">
          {filtered.map((e) => {
            const selected = e.key === value
            return (
              <li key={e.key}>
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onChange(e.key)}
                  className={`flex min-h-14 min-w-14 w-full flex-col items-center gap-1 rounded-xl border-2 p-2 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 ${
                    selected ? 'border-black bg-amber-200 ring-4 ring-amber-400' : 'border-black/10 bg-white'
                  }`}
                >
                  <Artwork artKey={e.key} size={40} decorative />
                  <span>{e.name}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
