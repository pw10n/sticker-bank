import type { RoutineDayState } from '../../api/types'

export const STATE_INFO: Record<RoutineDayState, { icon: string; text: string; cls: string }> = {
  EARNED: { icon: '⭐', text: 'Earned', cls: 'bg-sunshine/30 border-sunshine' },
  AWAITING_PICK: { icon: '🎁', text: 'Sticker waiting', cls: 'bg-ink/20 border-ink' },
  MISSED: { icon: '✕', text: 'Missed', cls: 'bg-white border-ink/40' },
  SKIPPED: { icon: '💤', text: 'Skipped', cls: 'bg-ink/5 border-ink/20 border-dashed' },
  IN_PROGRESS: { icon: '⏳', text: 'In progress', cls: 'bg-white border-ink/20' },
  NOT_STARTED: { icon: '○', text: 'Not started', cls: 'bg-white border-ink/20' },
}
