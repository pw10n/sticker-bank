import type { Weekday } from '../api/types'

const DAYS: { key: Weekday; short: string; name: string }[] = [
  { key: 'MON', short: 'M', name: 'Monday' },
  { key: 'TUE', short: 'T', name: 'Tuesday' },
  { key: 'WED', short: 'W', name: 'Wednesday' },
  { key: 'THU', short: 'T', name: 'Thursday' },
  { key: 'FRI', short: 'F', name: 'Friday' },
  { key: 'SAT', short: 'S', name: 'Saturday' },
  { key: 'SUN', short: 'S', name: 'Sunday' },
]
const ORDER = DAYS.map((d) => d.key)

export function WeekdayPicker({ value, onChange, label = 'Days' }: { value: Weekday[]; onChange(days: Weekday[]): void; label?: string }) {
  const emit = (days: Weekday[]) => onChange(ORDER.filter((d) => days.includes(d)))
  const toggle = (d: Weekday) => emit(value.includes(d) ? value.filter((x) => x !== d) : [...value, d])
  const quick = 'min-h-11 rounded-2xl border-2 border-ink/30 bg-white px-4 font-bold touch-manipulation focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-ink'
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-2">
      <span className="text-base font-bold">{label}</span>
      <div className="flex flex-wrap gap-2">
        {DAYS.map((d) => {
          const on = value.includes(d.key)
          return (
            <button
              key={d.key}
              type="button"
              aria-label={d.name}
              aria-pressed={on}
              onClick={() => toggle(d.key)}
              className={`h-11 w-11 shrink-0 rounded-full border-2 text-lg font-bold touch-manipulation focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-ink ${
                on ? 'border-ink bg-sunshine text-ink' : 'border-ink/30 bg-white text-ink'
              }`}
            >
              {d.short}
            </button>
          )
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={quick} onClick={() => emit(ORDER)}>
          Every day
        </button>
        <button type="button" className={quick} onClick={() => emit(['MON', 'TUE', 'WED', 'THU', 'FRI'])}>
          Weekdays
        </button>
        <button type="button" className={quick} onClick={() => emit(['SAT', 'SUN'])}>
          Weekends
        </button>
      </div>
    </div>
  )
}
