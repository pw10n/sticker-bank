import { PALETTE } from '../app/palette'

export function ColorSwatchPicker({ label, value, onChange, allowNone = false }: {
  label: string
  value: string | null
  onChange(hex: string | null): void
  allowNone?: boolean
}) {
  const current = value?.toUpperCase() ?? null
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-2">
      <span className="text-base font-bold">{label}</span>
      <div className="flex flex-wrap gap-3">
        {allowNone && (
          <button
            type="button"
            aria-pressed={value === null}
            onClick={() => onChange(null)}
            className={`min-h-11 rounded-full border-2 px-4 font-bold touch-manipulation focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-ink ${
              value === null ? 'border-ink bg-white ring-4 ring-ink' : 'border-ink/30 bg-white'
            }`}
          >
            No color
          </button>
        )}
        {PALETTE.map(({ key, hex }) => {
          const selected = current === hex
          return (
            <button
              key={key}
              type="button"
              aria-label={key}
              aria-pressed={selected}
              onClick={() => onChange(hex)}
              style={{ backgroundColor: hex }}
              className={`flex h-11 w-11 items-center justify-center rounded-full border-2 border-ink/40 text-xl font-bold text-ink touch-manipulation focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-ink ${
                selected ? 'ring-4 ring-ink ring-offset-2' : ''
              }`}
            >
              <span aria-hidden="true">{selected ? '✓' : ''}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
