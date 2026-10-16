import { useEffect, useRef, useState, type Ref } from 'react'
import { Link } from 'react-router'
import type { ChartRoutine } from '../../api/types'
import { Artwork } from '../../artwork'
import { BigTile, DOUBLE_TAP_GUARD_MS, ProgressRing } from '../../ui'

export interface RoutineCardProps {
  routine: ChartRoutine
  childId: number
  childColor: string
  highlighted: boolean
  canWrite: boolean
  pendingTaskIds: ReadonlySet<number>
  /** True while this routine's I'm Done! request is in flight. */
  finishing?: boolean
  onToggle(routine: ChartRoutine, taskId: number, done: boolean, tileEl: HTMLElement | null): void
  onFinish?(routine: ChartRoutine): void
  cardRef?: Ref<HTMLElement>
}

export function RoutineCard({
  routine,
  childId,
  childColor,
  highlighted,
  canWrite,
  pendingTaskIds,
  finishing = false,
  onToggle,
  onFinish,
  cardRef,
}: RoutineCardProps) {
  const [expanded, setExpanded] = useState(false)
  const accent = routine.color ?? childColor
  const earned = routine.state === 'EARNED'
  const awaiting = routine.state === 'AWAITING_PICK'
  // Ready to finish is not locked: tasks stay tappable so a mistaken tap can be undone before I'm Done! (FR-6.7).
  const readyToFinish = routine.state === 'READY_TO_FINISH'
  const locked = earned || awaiting
  const stickerKey = routine.sticker?.design?.artworkKey
  const earnedArtKey = stickerKey ?? 'glowing-star'
  const earnedAlt = stickerKey ? 'Your sticker' : 'Sticker earned'
  const progress = `${routine.doneCount} of ${routine.taskCount} done`

  const header = (
    <div className="flex items-center gap-4">
      <Artwork artKey={routine.iconKey} size={64} decorative />
      <h2 className="flex-1 text-[1.6rem] font-bold leading-tight">{routine.name}</h2>
      {!earned && <ProgressRing done={routine.doneCount} total={routine.taskCount} size={88} color={accent} />}
    </div>
  )

  if (earned && !expanded) {
    return (
      <section
        ref={cardRef}
        aria-label={routine.name}
        style={{ borderColor: accent }}
        className="flex items-center gap-4 rounded-[2rem] border-4 bg-white p-4"
      >
        <Artwork artKey={routine.iconKey} size={56} decorative />
        <div className="flex-1">
          <h2 className="text-[1.4rem] font-bold leading-tight">{routine.name}</h2>
          <p aria-live="polite" className="text-lg font-semibold">
            <span aria-hidden="true">✅ </span>Finished!
          </p>
        </div>
        <Artwork artKey={earnedArtKey} size={64} alt={earnedAlt} />
        <button
          type="button"
          aria-expanded={false}
          onClick={() => setExpanded(true)}
          className="min-h-[72px] touch-manipulation rounded-full border-4 border-ink/30 bg-white px-5 text-lg font-bold focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          Show
        </button>
      </section>
    )
  }

  return (
    <section
      ref={cardRef}
      aria-label={routine.name}
      data-highlighted={highlighted || undefined}
      style={{ borderColor: accent, backgroundColor: 'color-mix(in srgb, var(--child-color) 14%, white)' }}
      className={`flex flex-col gap-5 rounded-[2.5rem] border-[6px] p-5 shadow-[0_8px_0_rgba(27,27,47,0.15)] ${
        highlighted ? 'ring-8 ring-ink/40' : ''
      }`}
    >
      {header}
      <p aria-live="polite" className="text-[1.4rem] font-bold">
        {earned ? (
          <>
            <span aria-hidden="true">✅ </span>Finished!
          </>
        ) : readyToFinish ? (
          <>
            <span aria-hidden="true">🙌 </span>All tasks done. Tap I&apos;m Done!
          </>
        ) : (
          progress
        )}
      </p>

      {earned && (
        <div className="flex items-center gap-4">
          <Artwork artKey={earnedArtKey} size={96} alt={earnedAlt} />
          <button
            type="button"
            aria-expanded
            onClick={() => setExpanded(false)}
            className="min-h-[72px] touch-manipulation rounded-full border-4 border-ink/30 bg-white px-5 text-lg font-bold focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            Hide
          </button>
        </div>
      )}

      {awaiting && (
        <Link
          to={routine.sticker ? `/c/${childId}/pick/${routine.sticker.stickerId}` : `/c/${childId}`}
          className="flex min-h-[88px] touch-manipulation items-center justify-center gap-3 rounded-full border-4 border-ink bg-sunshine px-6 text-[1.6rem] font-bold text-ink shadow-[0_6px_0_rgba(27,27,47,0.2)] focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-ink"
        >
          <span aria-hidden="true">🎉</span>
          <span>Pick your sticker!</span>
        </Link>
      )}

      <ul className="grid grid-cols-2 gap-4">
        {routine.tasks.map((t) => (
          <li key={t.taskId} data-task-id={t.taskId}>
            <TaskTile
              label={t.label}
              iconKey={t.iconKey}
              done={t.done}
              color={accent}
              disabled={locked || !canWrite}
              busy={pendingTaskIds.has(t.taskId)}
              onPress={(el) => onToggle(routine, t.taskId, !t.done, el)}
            />
          </li>
        ))}
      </ul>

      {readyToFinish && canWrite && <FinishButton busy={finishing} onPress={() => onFinish?.(routine)} />}
    </section>
  )
}

/**
 * I'm Done! (FR-6.6): its own row below the tiles, so nothing under the finger moves when it appears, and it ignores
 * taps for a moment after it mounts so the tap that checked the last task cannot also press it.
 */
function FinishButton({ busy, onPress }: { busy: boolean; onPress(): void }) {
  const armed = useRef(false)
  useEffect(() => {
    const timer = setTimeout(() => {
      armed.current = true
    }, DOUBLE_TAP_GUARD_MS)
    return () => clearTimeout(timer)
  }, [])
  const handle = () => {
    if (busy || !armed.current) return
    onPress()
  }
  return (
    <div className="pt-2">
      <button
        type="button"
        aria-busy={busy || undefined}
        disabled={busy}
        onClick={handle}
        className="flex min-h-[88px] w-full touch-manipulation items-center justify-center gap-3 rounded-full border-4 border-ink bg-sunshine px-6 text-[1.8rem] font-bold text-ink shadow-[0_6px_0_rgba(27,27,47,0.2)] focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-ink disabled:opacity-60"
      >
        <span aria-hidden="true">✅</span>
        <span>I&apos;m Done!</span>
      </button>
    </div>
  )
}

function TaskTile({
  label,
  iconKey,
  done,
  color,
  disabled,
  busy,
  onPress,
}: {
  label: string
  iconKey: string
  done: boolean
  color: string
  disabled: boolean
  busy: boolean
  onPress(el: HTMLElement | null): void
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  return (
    <div ref={wrapRef} className="w-full">
      <BigTile
        icon={<Artwork artKey={iconKey} size={56} decorative />}
        label={label}
        pressed={done}
        disabled={disabled}
        busy={busy}
        color={color}
        className={`w-full ${disabled ? 'grayscale' : ''}`}
        onPress={() => onPress(wrapRef.current)}
      />
    </div>
  )
}
