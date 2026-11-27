import type { ChartSticker } from '../../api/types'
import { Artwork } from '../../artwork'
import { Button, Sheet, TextArea } from '../../ui'
import { dayLabel } from '../history/dates'

export const USED_EXPLANATION = "This sticker was already spent on a prize, so it can't be taken back."

export interface RevokeSheetProps {
  /** Whose task this is: a routine or a chore. */
  ownerKind: 'routine' | 'chore'
  /** The routine's or chore's name. */
  ownerName: string
  taskLabel: string
  childName: string
  /** ISO date shown in the sentence. */
  date: string
  sticker: ChartSticker
  lastInRequest: boolean
  note: string
  onNote(v: string): void
  busy: boolean
  errorKind: 'used' | 'other' | null
  onConfirm(): void
  onClose(): void
  /** Chore only: a line shown under the main text. */
  outcome?: string
  /** Chore only: value of the "Remove this chore too" checkbox. */
  removeChore?: boolean
  /** Chore only: change handler of the checkbox. The checkbox shows when this is given. */
  onRemoveChoreChange?(v: boolean): void
}

export function RevokeSheet({
  ownerKind,
  ownerName,
  taskLabel,
  childName,
  date,
  sticker,
  lastInRequest,
  note,
  onNote,
  busy,
  errorKind,
  onConfirm,
  onClose,
  outcome,
  removeChore,
  onRemoveChoreChange,
}: RevokeSheetProps) {
  const blocked = sticker.revocable === false || errorKind === 'used'
  return (
    <Sheet
      open
      onClose={busy ? () => {} : onClose}
      title="Remove this sticker?"
      footer={
        <div className="flex flex-wrap gap-2">
          {!blocked && (
            <Button variant="danger" loading={busy} onClick={onConfirm}>
              Remove sticker
            </Button>
          )}
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            {blocked ? 'OK' : 'Cancel'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          {sticker.design ? (
            <>
              <Artwork artKey={sticker.design.artworkKey} size={64} alt="" decorative />
              <span className="font-bold">{sticker.design.name}</span>
            </>
          ) : (
            <span className="font-bold">Not picked yet</span>
          )}
        </div>
        <p>
          Unchecking &apos;{taskLabel}&apos; in {ownerName} on {dayLabel(date, true)} removes this sticker from{' '}
          {childName}&apos;s Sticker Book. The {ownerKind} won&apos;t be finished until it&apos;s done again.
        </p>
        {outcome && <p>{outcome}</p>}
        {blocked ? (
          <p role="alert" className="font-bold">
            {USED_EXPLANATION}
          </p>
        ) : (
          <>
            {sticker.status === 'PENDING' && (
              <p className="font-bold">
                This sticker is in a prize request. It will be taken out
                {lastInRequest ? ', and the request will be cancelled' : ''}.
              </p>
            )}
            {onRemoveChoreChange && (
              <label className="flex min-h-11 items-center gap-3 font-bold">
                <input
                  type="checkbox"
                  className="h-6 w-6"
                  checked={removeChore ?? false}
                  disabled={busy}
                  onChange={(e) => onRemoveChoreChange(e.target.checked)}
                />
                Remove this chore too
              </label>
            )}
            <TextArea
              label="Note (optional)"
              maxLength={200}
              value={note}
              onChange={(e) => onNote(e.target.value)}
              disabled={busy}
            />
            {errorKind === 'other' && (
              <p role="alert" className="font-bold">
                Could not remove the sticker. Please try again.
              </p>
            )}
          </>
        )}
      </div>
    </Sheet>
  )
}
