import { NavLink, Outlet, useNavigate } from 'react-router'
import { useBootstrap } from '../api/hooks'
import { useDeviceSettings, useMode, useParentIdleTimer, VersionFooter } from '../app'
import { Badge, Button } from '../ui'

const LINKS = [
  { to: '/parent', label: 'Home', icon: '🏠', end: true },
  { to: '/parent/children', label: 'Children', icon: '🧒', end: false },
  { to: '/parent/library', label: 'Sticker Library', icon: '⭐', end: false },
  { to: '/parent/prizes', label: 'Prizes', icon: '🎁', end: false },
  { to: '/parent/settings', label: 'Settings', icon: '⚙️', end: false },
]

export default function ParentLayout() {
  const navigate = useNavigate()
  const { exitParentMode } = useMode()
  const { lastChildId } = useDeviceSettings()
  const bootstrap = useBootstrap()
  const pending = bootstrap.data?.pendingPrizeRequestCount ?? 0

  useParentIdleTimer({ onIdle: () => navigate('/') })

  const exit = async () => {
    await exitParentMode()
    navigate(lastChildId ? `/c/${lastChildId}` : '/')
  }

  return (
    <div className="min-h-dvh bg-paper text-ink md:grid md:grid-cols-[15rem_1fr]">
      <nav
        aria-label="Parent Mode"
        className="fixed inset-x-0 bottom-0 z-40 border-t-2 border-ink/10 bg-white md:sticky md:top-0 md:inset-auto md:h-dvh md:border-r-2 md:border-t-0"
      >
        <ul className="flex justify-around md:flex-col md:justify-start md:gap-1 md:p-3 md:pt-6">
          {LINKS.map((l) => (
            <li key={l.to} className="flex-1 md:flex-none">
              <NavLink
                to={l.to}
                end={l.end}
                className={({ isActive }) =>
                  `flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 py-1 text-xs font-bold focus-visible:outline-4 focus-visible:outline-offset-[-4px] focus-visible:outline-ink md:min-h-12 md:flex-row md:justify-start md:gap-3 md:rounded-2xl md:px-4 md:text-base ${
                    isActive ? 'bg-sunshine/40' : 'hover:bg-ink/5'
                  }`
                }
              >
                <span aria-hidden="true" className="text-xl">
                  {l.icon}
                </span>
                <span>{l.label}</span>
                {l.to === '/parent/prizes' && <Badge count={pending} />}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex min-h-dvh min-w-0 flex-col pb-24 md:pb-0">
        <header className="flex items-center justify-between gap-3 border-b-2 border-ink/10 bg-white px-4 py-3">
          <p className="text-xl font-bold">Parent Mode</p>
          <Button variant="secondary" onClick={() => void exit()}>
            Exit Parent Mode
          </Button>
        </header>
        <main className="mx-auto w-full max-w-4xl p-4 md:p-6">
          <Outlet />
        </main>
        <VersionFooter className="mt-auto pb-2 pt-4" />
      </div>
    </div>
  )
}
