import { useEffect } from 'react'
import { Navigate, NavLink, Outlet, useNavigate, useParams } from 'react-router'
import { useBootstrap } from '../api/hooks'
import { useDeviceSettings, VersionFooter } from '../app'
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
      <div className="flex min-h-dvh flex-col">
        <header className="flex flex-wrap items-center gap-4 border-b-4 border-ink/10 bg-[var(--child-color-soft)] px-4 py-2">
          <nav aria-label="Who is playing" className="order-1 flex items-center gap-4">
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
                    current ? 'border-ink ring-4 ring-white' : 'border-ink/30'
                  } focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-ink`}
                >
                  <Artwork artKey={c.avatarKey} size={48} decorative />
                </button>
              )
            })}
          </nav>
          <nav aria-label="Pages" className="order-3 grid w-full grid-cols-3 gap-4 sm:order-2 sm:flex sm:w-auto sm:flex-1 sm:justify-center">
            {nav.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  `flex min-h-[72px] touch-manipulation flex-col items-center justify-center whitespace-nowrap rounded-full border-4 border-ink px-1 text-[0.9375rem] font-bold sm:px-5 sm:text-[1.35rem] lg:flex-row lg:gap-2 text-ink focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-ink ${
                    isActive ? 'bg-[var(--child-color)]' : 'bg-white'
                  }`
                }
              >
                <span aria-hidden="true" className="text-3xl leading-none">
                  {n.icon}
                </span>
                <span>{n.label}</span>
              </NavLink>
            ))}
          </nav>
          <div className="order-2 ml-auto sm:order-3">
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
        <div className="flex-1">
          <Outlet />
        </div>
        <VersionFooter className="py-1" />
      </div>
    </ThemeScope>
  )
}
