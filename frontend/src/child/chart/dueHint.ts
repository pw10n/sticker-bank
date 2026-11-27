const DAY_MS = 86_400_000

function parse(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return null
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12)
}

/**
 * The words next to the alarm clock on a chore card (FR-13.19): "Today only", "By Saturday" within the next six
 * days, otherwise "By <date>". No due date, no hint.
 */
export function dueHint(dueDate: string | null | undefined, today: string): string | null {
  if (!dueDate) return null
  const due = parse(dueDate)
  const now = parse(today)
  if (due === null || now === null) return null
  const days = Math.round((due - now) / DAY_MS)
  if (days <= 0) return 'Today only'
  if (days <= 6) return `By ${new Date(due).toLocaleDateString(undefined, { weekday: 'long', timeZone: 'UTC' })}`
  return `By ${new Date(due).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })}`
}
