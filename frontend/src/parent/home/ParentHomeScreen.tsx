import { Link } from 'react-router'
import { useBootstrap, useParentPrizeRequests } from '../../api/hooks'
import { Artwork } from '../../artwork'
import { Card, PageHeader, Spinner } from '../../ui'

const LINK =
  'inline-flex min-h-11 items-center justify-center rounded-2xl border-2 border-ink/30 bg-white px-4 text-base font-bold text-ink focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-ink'
const PRIMARY =
  'inline-flex min-h-14 items-center justify-center rounded-2xl bg-sunshine px-6 text-lg font-bold text-ink shadow-[0_4px_0_rgba(27,27,47,0.25)] focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-ink'

export default function ParentHomeScreen() {
  const bootstrap = useBootstrap()
  const pendingQuery = useParentPrizeRequests({ status: ['PENDING'] })

  if (bootstrap.isPending) return <Spinner label="Loading" />
  const children = bootstrap.data?.children ?? []
  const pending = pendingQuery.data?.pages.flatMap((p) => p.items) ?? []
  const names = [...new Set(pending.map((p) => p.childName))]

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Home" />

      <Card accent="#FB8500">
        <h2 className="text-xl font-bold">Waiting for you</h2>
        {pendingQuery.isPending ? (
          <Spinner label="Loading" />
        ) : pending.length === 0 ? (
          <p className="mt-1">Nothing waiting. You’re all caught up!</p>
        ) : (
          <div className="mt-1 flex flex-col gap-3">
            <p>
              {pending.length} prize {pending.length === 1 ? 'request' : 'requests'} from {names.join(', ')}
            </p>
            <Link to="/parent/prizes" className={`${LINK} self-start`}>
              See prize requests
            </Link>
          </div>
        )}
      </Card>

      {children.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 py-8 text-center">
          <p className="text-lg">No children yet. Let’s add the first one.</p>
          <Link to="/parent/children/new" className={PRIMARY}>
            Add your first child
          </Link>
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {children.map((c) => (
            <li key={c.id}>
              <Card accent={c.themeColor} className="flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <Artwork artKey={c.avatarKey} size={56} decorative />
                  <h2 className="text-xl font-bold">{c.name}</h2>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link to={`/parent/children/${c.id}/routines`} className={LINK} aria-label={`Routines for ${c.name}`}>
                    Routines
                  </Link>
                  <Link to={`/parent/history/${c.id}`} className={LINK} aria-label={`History for ${c.name}`}>
                    History
                  </Link>
                  <Link to={`/parent/children/${c.id}`} className={LINK} aria-label={`Edit ${c.name}`}>
                    Edit
                  </Link>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-3">
        {children.length > 0 && (
          <Link to="/parent/children/new" className={LINK}>
            Add a child
          </Link>
        )}
        <Link to="/parent/library" className={LINK}>
          Sticker Library
        </Link>
        <Link to="/parent/settings" className={LINK}>
          Settings
        </Link>
      </div>
    </div>
  )
}
