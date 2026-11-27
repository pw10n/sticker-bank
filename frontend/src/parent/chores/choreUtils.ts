import type { ChartSticker, StickerStatus } from '../../api/types'
import { artworkForUse } from '../../artwork'
import { addDays, dayLabel } from '../history/dates'

export const MAX_CHORE_TASKS = 6
export const CHORE_LIMIT = 5

export const STATUS_LABEL: Record<StickerStatus, string> = {
  UNCLAIMED: 'Unclaimed',
  AVAILABLE: 'Available',
  PENDING: 'Pending',
  USED: 'Used',
  REVOKED: 'Removed',
}

/** The icon a new chore starts on. */
export function defaultChoreIcon(): string {
  const icons = artworkForUse('task')
  return icons.find((e) => e.key === 'broom')?.key ?? icons[0]?.key ?? 'broom'
}

/** "Due today", "Due tomorrow", "Due Sat, Mar 14" or "No due date". */
export function dueText(dueDate: string | null, today: string): string {
  if (!dueDate) return 'No due date'
  if (dueDate === today) return 'Due today'
  if (dueDate === addDays(today, 1)) return 'Due tomorrow'
  return `Due ${dayLabel(dueDate)}`
}

export interface TaskLike {
  label: string
  iconKey: string
}

/**
 * A chore whose only task repeats the chore's own name and icon is the simple case: the form shows an empty list
 * for it (I-35).
 */
export function isSimpleChore(name: string, iconKey: string, tasks: TaskLike[]): boolean {
  return tasks.length === 1 && tasks[0].label === name && tasks[0].iconKey === iconKey
}

export function limitMessage(childName: string): string {
  return `${childName} already has ${CHORE_LIMIT} chores to do.`
}

/** Whether the sticker was already awarded without a pick (the fallback Gold Star). */
export function awardedAtOnce(sticker: ChartSticker | null): boolean {
  return sticker?.status === 'AVAILABLE'
}
