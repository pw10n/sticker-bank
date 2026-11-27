import { Artwork } from '../../artwork'

export interface ToastChore {
  choreId: number
  name: string
  iconKey: string
}

/**
 * "New chore!" (FR-13.14). Fixed at the top of the screen with its own safe-area inset, so it moves nothing in the
 * layout. It has two neighbours it must never cover or be covered by: the offline banner above it (fixed at the top,
 * about 2.5rem tall plus the inset, so the toast starts at 3.25rem) and the update toast at the bottom (Parent Mode
 * only). The live region is always mounted so a screen reader announces the toast when it appears. The button is at
 * least 72 px tall; tapping it is up to the caller (scroll to the card).
 */
export function NewChoreToast({ chores, onPress }: { chores: ToastChore[]; onPress(): void }) {
  const first = chores[0]
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-[calc(3.25rem+env(safe-area-inset-top))] z-40 flex justify-center px-4"
    >
      {first && (
        <button
          type="button"
          data-testid="new-chore-toast"
          onClick={onPress}
          className="pointer-events-auto flex min-h-[72px] max-w-[min(100%,26rem)] touch-manipulation items-center gap-3 rounded-[2.25rem] border-4 border-ink bg-sunshine px-5 py-2 text-left text-[1.4rem] leading-tight font-bold text-ink shadow-[0_6px_0_rgba(27,27,47,0.2)] focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-ink"
        >
          {chores.length === 1 ? (
            <>
              <Artwork artKey={first.iconKey} size={48} decorative />
              <span className="flex min-w-0 flex-col">
                <span>New chore!</span>
                <span className="line-clamp-2 break-words">{first.name}</span>
              </span>
            </>
          ) : (
            <>
              <span aria-hidden="true">🧹</span>
              <span>{chores.length} new chores!</span>
            </>
          )}
        </button>
      )}
    </div>
  )
}
