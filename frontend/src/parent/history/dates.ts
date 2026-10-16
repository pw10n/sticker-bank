const DAY_MS = 86_400_000

export function parseDate(s: string): number {
  const [y, m, d] = s.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

export function formatDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export function addDays(s: string, n: number): string {
  return formatDate(parseDate(s) + n * DAY_MS)
}

/** Monday of the week containing the date. */
export function weekStart(s: string): string {
  const dow = new Date(parseDate(s)).getUTCDay() // 0 = Sunday
  return addDays(s, -((dow + 6) % 7))
}

export function weekDates(start: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i))
}

export function dayLabel(s: string, long = false): string {
  return new Date(parseDate(s)).toLocaleDateString('en-US', {
    weekday: long ? 'long' : 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}
