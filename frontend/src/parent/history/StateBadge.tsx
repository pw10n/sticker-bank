import type { RoutineDayState } from '../../api/types'
import { STATE_INFO } from './stateInfo'

export function StateBadge({
  state,
  doneCount,
  taskCount,
}: {
  state: RoutineDayState
  doneCount: number
  taskCount: number
}) {
  const info = STATE_INFO[state]
  const showCount = state === 'MISSED' || state === 'IN_PROGRESS' || state === 'NOT_STARTED'
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border-2 px-2 py-0.5 text-sm font-bold ${info.cls}`}>
      <span aria-hidden="true">{info.icon}</span>
      {info.text}
      {showCount && <span className="font-normal">{` ${doneCount}/${taskCount}`}</span>}
    </span>
  )
}
