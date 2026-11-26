import { Artwork } from '../../artwork'

export interface ToastChore {
  choreId: number
  name: string
  iconKey: string
}

/**
 * "New chore!" (FR-13.14). Fixed over the page with its own safe-area inset, so it moves nothing in the layout. The
 * live region is always mounted so a screen reader announces the toast when it appears. The button is at least 72 px
 * tall; tapping it is up to the caller (scroll to the card).
 */
export function NewChoreToast({ chores, onPress }: { chores: ToastChore[]; onPress(): void }) {
  const first = chores[0]
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-4"
    >
      {first && (
        <button
          type="button"
          data-testid="new-chore-toast"
          onClick={onPress}
          className="pointer-events-auto flex min-h-[72px] touch-manipulation items-center gap-3 rounded-full border-4 border-ink bg-sunshine px-6 text-[1.4rem] font-bold text-ink shadow-[0_6px_0_rgba(27,27,47,0.2)] focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-ink"
        >
          {chores.length === 1 ? (
            <>
              <Artwork artKey={first.iconKey} size={48} decorative />
              <span>New chore!</span>
              <span>{first.name}</span>
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
