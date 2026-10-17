import { useEffect, useRef, useState } from 'react'
import { Navigate, NavLink, Outlet, useNavigate, useParams } from 'react-router'
import { useBootstrap } from '../api/hooks'
import { useDeviceSettings, VersionFooter } from '../app'
import { Artwork } from '../artwork'
import { HoldButton, Spinner, ThemeScope } from '../ui'

// The switcher is one fixed-size chip (the other children live in a popover), so
// the header's width no longer depends on the child count. Below 51rem the header
// is two rows; from 51rem avatars, page links and Parent Mode share one row, and
// from 70rem the page links get large labels. Tailwind needs literal class names.
const ROW = {
  nav: '@[51rem]:flex-none @[51rem]:flex-nowrap',
  pages: '@[51rem]:order-2 @[51rem]:flex @[51rem]:w-auto @[51rem]:flex-1 @[51rem]:justify-center',
  pill: '@[51rem]:px-2',
  parent: '@[51rem]:order-3 @[51rem]:self-center',
  big: '@[70rem]:px-5 @[70rem]:text-[1.35rem] @[70rem]:flex-row @[70rem]:gap-2',
}

type Kid = { id: number; name: string; themeColor: string; avatarKey: string }

function Avatar({ c }: { c: Kid }) {
  return (
    <span
      style={{ backgroundColor: c.themeColor }}
      className="flex h-[56px] w-[56px] shrink-0 items-center justify-center rounded-full border-4 border-ink/30"
    >
      <Artwork artKey={c.avatarKey} size={40} decorative />
    </span>
  )
}

const FOCUS = 'focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-ink'

// Shows the current child's name; tapping opens a list of everyone's names to switch to.
function ChildSwitcher({ kids, current, onSwitch }: { kids: Kid[]; current: Kid; onSwitch: (id: number) => void }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const toggle = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        toggle.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const chip = (
    <>
      <Avatar c={current} />
      <span className="min-w-0 truncate text-xl font-bold">{current.name}</span>
    </>
  )
  const chipClass =
    'flex min-h-[72px] max-w-[14rem] touch-manipulation items-center gap-3 rounded-full border-4 border-ink bg-white py-1 pl-2 pr-5 text-ink'

  if (kids.length < 2) return <div className={chipClass}>{chip}</div>

  return (
    <div ref={root} className="relative">
      <button
        ref={toggle}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`${current.name}, switch child`}
        onClick={() => setOpen((o) => !o)}
        className={`${chipClass} ${FOCUS}`}
      >
        {chip}
        <span aria-hidden="true" className="text-lg">
          {open ? '▲' : '▼'}
        </span>
      </button>
      {open ? (
        <ul
          aria-label="Who is playing"
          className="absolute left-0 top-full z-20 mt-2 flex max-h-[70dvh] min-w-full flex-col gap-2 overflow-y-auto rounded-3xl border-4 border-ink bg-white p-2 shadow-[0_8px_0_rgba(27,27,47,0.2)]"
        >
          {kids.map((c) => {
            const isCurrent = c.id === current.id
            return (
              <li key={c.id}>
                <button
                  type="button"
                  aria-current={isCurrent ? 'true' : undefined}
                  onClick={() => {
                    setOpen(false)
                    if (!isCurrent) onSwitch(c.id)
                  }}
                  className={`flex min-h-[72px] w-full touch-manipulation items-center gap-3 whitespace-nowrap rounded-full border-4 py-1 pl-2 pr-5 text-left text-xl font-bold text-ink ${
                    isCurrent ? 'border-ink bg-[var(--child-color-soft)]' : 'border-transparent'
                  } ${FOCUS}`}
                >
                  <Avatar c={c} />
                  <span>{c.name}</span>
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}

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

  const row = ROW
  const kids = [...data.children].sort((a, b) => a.position - b.position)
  const nav = [
    { to: `/c/${child.id}`, end: true, icon: '⭐', label: 'My chart' },
    {
      to: `/c/${child.id}/book`,
      end: false,
      icon: '📖',
      label: 'Sticker Book',
    },
    {
      to: `/c/${child.id}/prize`,
      end: false,
      icon: '🎁',
      label: 'Get a Prize',
    },
  ]

  return (
    <ThemeScope color={child.themeColor} className="min-h-dvh bg-paper text-ink">
      <div className="flex min-h-dvh flex-col">
        <div className="@container">
          <header className="flex flex-wrap items-center gap-4 border-b-4 border-ink/10 bg-[var(--child-color-soft)] px-4 py-2">
            <nav
              aria-label="Who is playing"
              className={`order-1 flex min-w-0 flex-1 flex-wrap items-center gap-4 ${row.nav}`}
            >
              <ChildSwitcher kids={kids} current={child} onSwitch={(id) => navigate(`/c/${id}`)} />
            </nav>
            <nav aria-label="Pages" className={`order-3 grid w-full grid-cols-3 gap-4 ${row.pages}`}>
              {nav.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  end={n.end}
                  className={({ isActive }) =>
                    `flex min-h-[72px] touch-manipulation flex-col items-center justify-center whitespace-nowrap rounded-full border-4 border-ink px-1 text-[0.9375rem] font-bold ${row.pill} ${row.big} text-ink focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-ink ${
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
            <div className={`order-2 ml-auto shrink-0 self-start ${row.parent}`}>
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
        </div>
        <div className="flex-1">
          <Outlet />
        </div>
        <VersionFooter className="py-1" />
      </div>
    </ThemeScope>
  )
}
