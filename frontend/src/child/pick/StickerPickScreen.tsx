import { useCallback, useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router'
import { motion } from 'motion/react'
import { useClaimPick, useStickerPick } from '../../api/hooks'
import { isApiError } from '../../api/errors'
import type { StickerPick } from '../../api/types'
import { useCanWrite, useCelebrationGuard } from '../../app'
import { Artwork } from '../../artwork'
import { useSound } from '../../sound'
import { Button, Spinner, useReducedMotion } from '../../ui'

type DesignRef = StickerPick['choices'][number]

type Sticking = { chosen: DesignRef; choices: DesignRef[] }

export default function StickerPickScreen() {
  const params = useParams()
  const childId = Number(params.childId)
  const stickerId = Number(params.stickerId)
  const navigate = useNavigate()
  const pickQuery = useStickerPick(stickerId)
  const claim = useClaimPick(childId)
  const canWrite = useCanWrite()
  const reduced = useReducedMotion()
  const { play } = useSound()
  const { setCelebrating } = useCelebrationGuard()
  const [sticking, setSticking] = useState<Sticking | null>(null)
  const [justClaimed, setJustClaimed] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
      setCelebrating(false)
    },
    [setCelebrating],
  )

  const pick = pickQuery.data
  const refetch = pickQuery.refetch

  const choose = useCallback(
    (design: DesignRef, choices: DesignRef[]) => {
      setMessage(null)
      claim.mutate(
        { stickerId, designId: design.designId },
        {
          onSuccess: () => {
            play('stick')
            setCelebrating(true)
            setJustClaimed(true)
            setSticking({ chosen: design, choices })
            timer.current = setTimeout(
              () => {
                setSticking(null)
                setCelebrating(false)
              },
              reduced ? 300 : 900,
            )
          },
          onError: (e) => {
            const gone = isApiError(e, 'NOT_FOUND') || isApiError(e, 'STICKER_REVOKED')
            if (!gone) play('error')
            if (gone) {
              // A parent took the sticker back while this pick was open: go back quietly.
              void navigate(`/c/${childId}`, { replace: true })
            } else if (isApiError(e, 'ALREADY_CLAIMED') || isApiError(e, 'CHOICE_NOT_OFFERED')) {
              void refetch()
            } else {
              setMessage('Oops, that did not work. Please try again!')
            }
          },
        },
      )
    },
    [claim, stickerId, childId, navigate, play, setCelebrating, reduced, refetch],
  )

  if (!Number.isFinite(childId) || !Number.isFinite(stickerId)) return <Navigate to="/" replace />
  const chartPath = `/c/${childId}`

  if (isApiError(pickQuery.error, 'NOT_FOUND')) return <Navigate to={chartPath} replace />

  if (pickQuery.isPending) {
    return (
      <main data-testid="screen-sticker-pick-screen" className="flex min-h-dvh items-center justify-center bg-paper">
        <Spinner />
      </main>
    )
  }
  if (!pick) {
    return (
      <main data-testid="screen-sticker-pick-screen" className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-paper p-6 text-ink">
        <p className="text-2xl font-bold">We could not find that sticker.</p>
        <Button size="xl" onClick={() => void navigate(chartPath)}>
          Back to my chart
        </Button>
      </main>
    )
  }
  if (pick.childId !== childId) return <Navigate to={chartPath} replace />
  // A grown-up took this sticker back: close quietly (FR-12.10).
  if (pick.status === 'REVOKED') return <Navigate to={chartPath} replace />

  const closeButton = (
    <button
      type="button"
      onClick={() => void navigate(chartPath)}
      className="absolute right-4 top-4 min-h-[56px] min-w-[72px] rounded-full border-4 border-ink/25 bg-white px-5 text-lg font-bold text-ink touch-manipulation"
    >
      Not now
    </button>
  )

  const shell = (children: React.ReactNode, withClose: boolean) => (
    <main
      data-testid="screen-sticker-pick-screen"
      className="relative flex min-h-dvh flex-col items-center gap-6 bg-paper px-4 pb-10 pt-20 text-ink"
    >
      {withClose && closeButton}
      {children}
    </main>
  )

  if (sticking) {
    return shell(
      <>
        <h1 className="text-center text-4xl font-bold">Sticking it in...</h1>
        <div className="flex flex-wrap items-start justify-center gap-6">
          {sticking.choices.map((c) => {
            const isChosen = c.designId === sticking.chosen.designId
            return (
              <motion.div
                key={c.designId}
                data-testid={isChosen ? 'sticking-chosen' : 'sticking-other'}
                className="flex flex-col items-center gap-2 rounded-[2rem] border-4 border-ink/25 bg-white p-4"
                initial={{ opacity: 1, y: 0, scale: 1 }}
                animate={
                  reduced
                    ? { opacity: 0 }
                    : isChosen
                      ? { opacity: 0, y: -320, scale: 0.2 }
                      : { opacity: 0 }
                }
                transition={{ duration: reduced ? 0.2 : 0.8 }}
              >
                <Artwork artKey={c.artworkKey} size={160} alt={c.name} />
                <span className="text-xl font-bold">{c.name}</span>
              </motion.div>
            )
          })}
        </div>
      </>,
      false,
    )
  }

  if (pick.status !== 'UNCLAIMED') {
    const claimed = pick.claimed
    const heading = pick.autoAwarded
      ? "Here's a Gold Star for finishing!"
      : justClaimed
        ? "It's in your Sticker Book!"
        : claimed
          ? `You got a ${claimed.name}!`
          : "It's in your Sticker Book!"
    return shell(
      <>
        <h1 className="text-center text-4xl font-bold">{heading}</h1>
        {justClaimed && claimed && !pick.autoAwarded && (
          <p className="text-center text-2xl">You got a {claimed.name}!</p>
        )}
        {claimed && (
          <div className="flex flex-col items-center gap-2 rounded-[2rem] border-4 border-ink bg-white p-6 shadow-[0_6px_0_rgba(27,27,47,0.18)]">
            <Artwork artKey={claimed.artworkKey} size={200} alt={claimed.name} />
            <span className="text-2xl font-bold">{claimed.name}</span>
          </div>
        )}
        <div className="flex flex-col items-center gap-4 sm:flex-row">
          <Button size="xl" onClick={() => void navigate(`${chartPath}/book`)}>
            See my Sticker Book
          </Button>
          <Button size="xl" variant="secondary" onClick={() => void navigate(chartPath)}>
            Back to my chart
          </Button>
        </div>
      </>,
      false,
    )
  }

  return shell(
    <>
      <h1 className="text-center text-4xl font-bold">Pick your sticker!</h1>
      {pick.routineName && <p className="text-center text-2xl">{pick.routineName}</p>}
      <div className="flex flex-wrap items-stretch justify-center gap-6">
        {pick.choices.map((c) => (
          <motion.button
            key={c.designId}
            type="button"
            disabled={!canWrite || claim.isPending}
            onClick={() => choose(c, pick.choices)}
            whileTap={reduced ? undefined : { scale: 0.95 }}
            className="flex min-h-[220px] min-w-[200px] flex-col items-center justify-center gap-2 rounded-[2rem] border-4 border-ink/25 bg-white p-4 text-ink shadow-[0_6px_0_rgba(27,27,47,0.18)] touch-manipulation focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-ink disabled:opacity-60"
          >
            <Artwork artKey={c.artworkKey} size={160} alt="" decorative />
            <span className="text-xl font-bold">{c.name}</span>
          </motion.button>
        ))}
      </div>
      {!canWrite && <p className="text-lg font-bold">You are offline. Try again when you are back online.</p>}
      {message && (
        <p role="alert" className="text-lg font-bold">
          {message}
        </p>
      )}
    </>,
    true,
  )
}
