import { Link } from 'react-router'
import { useChildren } from '../../api/hooks'
import { Artwork } from '../../artwork'
import { Card, EmptyState, PageHeader, Spinner } from '../../ui'

const LINK_BTN =
  'inline-flex min-h-11 items-center justify-center rounded-2xl border-2 border-ink/30 bg-white px-4 text-base font-bold text-ink shadow-[0_3px_0_rgba(27,27,47,0.12)] focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-ink'
const PRIMARY_LINK =
  'inline-flex min-h-11 items-center justify-center rounded-2xl bg-sunshine px-5 text-base font-bold text-ink shadow-[0_4px_0_rgba(27,27,47,0.25)] focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-ink'

export default function ChildrenScreen() {
  const children = useChildren()
  const list = [...(children.data ?? [])].sort((a, b) => a.position - b.position)

  return (
    <main data-testid="screen-children-screen" className="mx-auto flex max-w-2xl flex-col gap-4 p-4">
      <PageHeader
        title="Children"
        back={{ to: '/parent' }}
        actions={
          <Link to="/parent/children/new" className={PRIMARY_LINK}>
            Add a child
          </Link>
        }
      />
      {children.isPending && <Spinner label="Loading children" />}
      {children.isError && <p role="alert">Couldn't load the children. Please try again.</p>}
      {children.isSuccess && list.length === 0 && (
        <EmptyState
          icon="🧒"
          title="No children yet"
          message="Add a child to start building their routines."
          action={
            <Link to="/parent/children/new" className={PRIMARY_LINK}>
              Add a child
            </Link>
          }
        />
      )}
      {list.length > 0 && (
        <ul className="flex flex-col gap-3">
          {list.map((child) => (
            <li key={child.id}>
              <Card accent={child.themeColor}>
                <div className="flex flex-wrap items-center gap-3">
                  <Artwork artKey={child.avatarKey} size={56} decorative />
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <h2 className="truncate text-xl font-bold">{child.name}</h2>
                    <span
                      role="img"
                      aria-label="Theme color"
                      style={{ backgroundColor: child.themeColor }}
                      className="inline-block h-5 w-5 shrink-0 rounded-full border-2 border-ink/40"
                    />
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link to={`/parent/children/${child.id}`} className={LINK_BTN} aria-label={`Edit ${child.name}`}>
                    Edit
                  </Link>
                  <Link
                    to={`/parent/children/${child.id}/routines`}
                    className={LINK_BTN}
                    aria-label={`Routines for ${child.name}`}
                  >
                    Routines
                  </Link>
                  <Link to={`/parent/history/${child.id}`} className={LINK_BTN} aria-label={`History for ${child.name}`}>
                    History
                  </Link>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
