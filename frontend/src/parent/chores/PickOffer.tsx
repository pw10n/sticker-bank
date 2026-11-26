import { useNavigate } from 'react-router'
import { useMode } from '../../app'
import { Button } from '../../ui'

export interface PickOfferProps {
  childId: number
  childName: string
  choreName: string
  stickerId: number
  /** The sticker was awarded at once (a Gold Star was added), so there is nothing to pick. */
  autoAwarded: boolean
  onDone(): void
}

/** What the parent sees after a chore earned a sticker: let the child pick now, or leave it in their tray. */
export function PickOffer({ childId, childName, choreName, stickerId, autoAwarded, onDone }: PickOfferProps) {
  const navigate = useNavigate()
  const { exitParentMode } = useMode()

  const pickNow = async () => {
    await exitParentMode()
    navigate(`/c/${childId}/pick/${stickerId}`)
  }

  if (autoAwarded) {
    return (
      <div role="status" data-testid="chore-pick-offer" className="rounded-2xl border-2 border-sunshine bg-sunshine/20 p-3 font-bold">
        {childName} earned a sticker for {choreName}! A Gold Star was added.
        <div className="mt-2">
          <Button onClick={onDone}>OK</Button>
        </div>
      </div>
    )
  }
  return (
    <div role="status" data-testid="chore-pick-offer" className="rounded-2xl border-2 border-sunshine bg-sunshine/20 p-3">
      <p className="font-bold">
        {childName} earned a sticker for {choreName}!
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button onClick={() => void pickNow()}>Let {childName} pick now</Button>
        <Button variant="secondary" onClick={onDone}>
          Later — it waits in their &apos;Stickers to pick&apos; tray
        </Button>
      </div>
    </div>
  )
}
