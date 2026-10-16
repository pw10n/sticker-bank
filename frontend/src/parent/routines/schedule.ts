import type { Weekday } from '../../api/types'

const ORDER: Weekday[] = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']
const SHORT: Record<Weekday, string> = {
  MON: 'Mon',
  TUE: 'Tue',
  WED: 'Wed',
  THU: 'Thu',
  FRI: 'Fri',
  SAT: 'Sat',
  SUN: 'Sun',
}

export function scheduleSummary(days: Weekday[]): string {
  const set = new Set(days)
  const sorted = ORDER.filter((d) => set.has(d))
  if (sorted.length === 7) return 'Every day'
  if (sorted.length === 0) return 'No days'
  if (sorted.length === 5 && !set.has('SAT') && !set.has('SUN')) return 'Weekdays'
  if (sorted.length === 2 && set.has('SAT') && set.has('SUN')) return 'Weekends'
  return sorted.map((d) => SHORT[d]).join(', ')
}

export const ALL_DAYS: Weekday[] = [...ORDER]

export function formatDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d) return date
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

export function moveIndex<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return list
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}
