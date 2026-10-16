/** "Yesterday" / "Monday" style label for a YYYY-MM-DD date, relative to `today`. */
export function friendlyDate(date: string, today: string): string {
  const d = parse(date)
  const t = parse(today)
  if (!d || !t) return date
  const days = Math.round((t.getTime() - d.getTime()) / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'long' })
}

function parse(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return null
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12))
}
