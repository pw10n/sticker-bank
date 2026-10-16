import { Navigate, useNavigate } from 'react-router'
import { useBootstrap } from '../api/hooks'
import { useDeviceSettings } from '../app'
import { Artwork } from '../artwork'
import { EmptyState, HoldButton, Spinner } from '../ui'

export default function ChildPickerScreen() {
  const bootstrap = useBootstrap()
  const { lastChildId, setLastChildId } = useDeviceSettings()
  const navigate = useNavigate()

  if (bootstrap.isPending) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-paper text-ink" aria-busy="true">
        <Spinner />
      </main>
    )
  }
  if (bootstrap.isError || !bootstrap.data) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-paper p-6 text-ink">
        <EmptyState icon="☁️" title="Waiting for Wi-Fi…" message="We will be right back!" />
      </main>
    )
  }

  const { children, setupRequired } = bootstrap.data
  if (setupRequired && children.length === 0) return <Navigate to="/welcome" replace />
  if (lastChildId !== null && children.some((c) => c.id === lastChildId)) {
    return <Navigate to={`/c/${lastChildId}`} replace />
  }

  return (
    <main className="min-h-dvh bg-paper p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] text-ink">
      <div className="mx-auto flex max-w-4xl justify-end">
        <HoldButton
          label="Parent Mode"
          badge={bootstrap.data.pendingPrizeRequestCount}
          onHoldComplete={() => navigate('/parent')}
          className="text-sm"
        >
          <span aria-hidden="true">🔒</span>
          {children.length === 0 ? <span aria-hidden="true">Parent Mode</span> : null}
        </HoldButton>
      </div>
      {children.length === 0 ? (
        <div className="mx-auto flex max-w-xl flex-col gap-6 pt-10">
          <EmptyState icon="🌈" title="Ask a grown-up to add you!" />
        </div>
      ) : (
        <div className="mx-auto flex max-w-4xl flex-col items-center gap-8">
          <h1 className="text-4xl font-bold">Who is playing?</h1>
          <ul className="grid w-full grid-cols-1 gap-6 sm:grid-cols-2">
            {[...children]
              .sort((a, b) => a.position - b.position)
              .map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setLastChildId(c.id)
                      navigate(`/c/${c.id}`)
                    }}
                    style={{ backgroundColor: c.themeColor }}
                    className="flex min-h-[160px] w-full touch-manipulation select-none flex-col items-center justify-center gap-3 rounded-[2.5rem] border-4 border-ink p-6 text-[1.75rem] font-bold text-ink shadow-[0_8px_0_rgba(27,27,47,0.2)] focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-ink"
                  >
                    <span className="flex h-28 w-28 items-center justify-center rounded-full bg-white/80">
                      <Artwork artKey={c.avatarKey} size={96} decorative />
                    </span>
                    <span className="rounded-full bg-white/80 px-5 py-1">{c.name}</span>
                  </button>
                </li>
              ))}
          </ul>
        </div>
      )}
    </main>
  )
}
