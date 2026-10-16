import { useEffect } from 'react'
import { Navigate, NavLink, Outlet, useNavigate, useParams } from 'react-router'
import { useBootstrap } from '../api/hooks'
import { useDeviceSettings } from '../app'
import { Artwork } from '../artwork'
import { HoldButton, Spinner, ThemeScope } from '../ui'

export default function ChildLayout() {
  const { childId: rawId } = useParams()
  const childId = Number(rawId)
  const bootstrap = useBootstrap()
  const { setLastChildId } = useDeviceSettings()
  const navigate = useNavigate()

  const data = bootstrap.data
  const child = data?.children.find((c) => c.id === childId)

  useEffect(() => {
    if (child) setLastChildId(child.id)
  }, [child, setLastChildId])

  if (!data) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-paper text-ink" aria-busy="true">
        <Spinner />
      </main>
    )
  }
  if (!child) return <Navigate to="/" replace />

  const nav = [
    { to: `/c/${child.id}`, end: true, icon: '⭐', label: 'My chart' },
    { to: `/c/${child.id}/book`, end: false, icon: '📖', label: 'Sticker Book' },
    { to: `/c/${child.id}/prize`, end: false, icon: '🎁', label: 'Get a Prize' },
  ]

  return (
    <ThemeScope color={child.themeColor} className="min-h-dvh bg-paper text-ink">
      <div className="flex min-h-dvh flex-col pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] pt-[env(safe-area-inset-top)]">
        <header className="flex flex-wrap items-center gap-3 border-b-4 border-ink/10 bg-[var(--child-color-soft)] px-4 py-3">
          <nav aria-label="Who is playing" className="flex items-center gap-3">
            {data.children.map((c) => {
              const current = c.id === child.id
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-label={c.name}
                  aria-current={current ? 'true' : undefined}
                  onClick={() => {
                    if (!current) navigate(`/c/${c.id}`)
                  }}
                  style={{ backgroundColor: c.themeColor }}
                  className={`flex h-[72px] w-[72px] touch-manipulation items-center justify-center rounded-full border-4 ${
                    current ? 'scale-110 border-ink ring-4 ring-white' : 'border-ink/30'
                  } focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-ink`}
                >
                  <Artwork artKey={c.avatarKey} size={48} decorative />
                </button>
              )
            })}
          </nav>
          <nav aria-label="Pages" className="flex flex-1 flex-wrap items-center justify-center gap-3">
            {nav.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  `flex min-h-[72px] touch-manipulation items-center gap-2 rounded-full border-4 border-ink px-5 text-[1.35rem] font-bold text-ink focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-ink ${
                    isActive ? 'bg-[var(--child-color)]' : 'bg-white'
                  }`
                }
              >
                <span aria-hidden="true" className="text-3xl">
                  {n.icon}
                </span>
                <span>{n.label}</span>
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto">
            <HoldButton
              label="Parent Mode"
              badge={data.pendingPrizeRequestCount}
              onHoldComplete={() => navigate('/parent')}
              className="text-sm"
            >
              <span aria-hidden="true">🔒</span>
            </HoldButton>
          </div>
        </header>
        <div className="flex-1 pb-[env(safe-area-inset-bottom)]">
          <Outlet />
        </div>
      </div>
    </ThemeScope>
  )
}
