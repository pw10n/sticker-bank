import { useEffect } from 'react'
import { Navigate, NavLink, Outlet, useNavigate, useParams } from 'react-router'
import { useBootstrap } from '../api/hooks'
import { useDeviceSettings, VersionFooter } from '../app'
import { Artwork } from '../artwork'
import { HoldButton, Spinner, ThemeScope } from '../ui'

// One-row header thresholds by child count (container width). Each avatar adds
// 72 + 16 px, so the width at which avatars, page links and Parent Mode fit on
// one row grows with the number of children: compact pills need about
// 88 * N + 460 px, large labels about 88 * N + 750 px, each plus ~90 px of
// slack. Tailwind needs literal class names, hence the table. Below the
// threshold the header is two rows and the avatars wrap inside their cluster.
const ROW_CLASSES = {
  // 1-2 children: one row from 45rem, large labels from 64rem
  a: {
    nav: '@[45rem]:flex-none @[45rem]:flex-nowrap',
    pages: '@[45rem]:order-2 @[45rem]:flex @[45rem]:w-auto @[45rem]:flex-1 @[45rem]:justify-center',
    pill: '@[45rem]:px-2',
    parent: '@[45rem]:order-3 @[45rem]:self-center',
    big: '@[64rem]:px-5 @[64rem]:text-[1.35rem] @[64rem]:flex-row @[64rem]:gap-2',
  },
  // 3 children: 51rem / 70rem
  b: {
    nav: '@[51rem]:flex-none @[51rem]:flex-nowrap',
    pages: '@[51rem]:order-2 @[51rem]:flex @[51rem]:w-auto @[51rem]:flex-1 @[51rem]:justify-center',
    pill: '@[51rem]:px-2',
    parent: '@[51rem]:order-3 @[51rem]:self-center',
    big: '@[70rem]:px-5 @[70rem]:text-[1.35rem] @[70rem]:flex-row @[70rem]:gap-2',
  },
  // 4 children: 57rem / 75rem
  c: {
    nav: '@[57rem]:flex-none @[57rem]:flex-nowrap',
    pages: '@[57rem]:order-2 @[57rem]:flex @[57rem]:w-auto @[57rem]:flex-1 @[57rem]:justify-center',
    pill: '@[57rem]:px-2',
    parent: '@[57rem]:order-3 @[57rem]:self-center',
    big: '@[75rem]:px-5 @[75rem]:text-[1.35rem] @[75rem]:flex-row @[75rem]:gap-2',
  },
  // 5 children: 62rem / 81rem
  d: {
    nav: '@[62rem]:flex-none @[62rem]:flex-nowrap',
    pages: '@[62rem]:order-2 @[62rem]:flex @[62rem]:w-auto @[62rem]:flex-1 @[62rem]:justify-center',
    pill: '@[62rem]:px-2',
    parent: '@[62rem]:order-3 @[62rem]:self-center',
    big: '@[81rem]:px-5 @[81rem]:text-[1.35rem] @[81rem]:flex-row @[81rem]:gap-2',
  },
  // 6 or more children: 72rem / 96rem
  e: {
    nav: '@[72rem]:flex-none @[72rem]:flex-nowrap',
    pages: '@[72rem]:order-2 @[72rem]:flex @[72rem]:w-auto @[72rem]:flex-1 @[72rem]:justify-center',
    pill: '@[72rem]:px-2',
    parent: '@[72rem]:order-3 @[72rem]:self-center',
    big: '@[96rem]:px-5 @[96rem]:text-[1.35rem] @[96rem]:flex-row @[96rem]:gap-2',
  },
  // 8 or more children: always two rows, so Parent Mode stays top-right however many avatars wrap
  f: { nav: '', pages: '', pill: '', parent: '', big: '' },
} as const

function rowClasses(count: number) {
  if (count <= 2) return ROW_CLASSES.a
  if (count === 3) return ROW_CLASSES.b
  if (count === 4) return ROW_CLASSES.c
  if (count === 5) return ROW_CLASSES.d
  if (count <= 7) return ROW_CLASSES.e
  return ROW_CLASSES.f
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

  const row = rowClasses(data.children.length)
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
