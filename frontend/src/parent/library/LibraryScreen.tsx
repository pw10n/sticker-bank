import { useEffect, useState } from 'react'
import { Artwork } from '../../artwork'
import { isApiError } from '../../api/errors'
import { useCategories, useDeleteDesign, useLibrary, useSetDesignStatus } from '../../api/hooks'
import type { Design, DesignStatus } from '../../api/types'
import { Button, Card, ConfirmDialog, EmptyState, FieldError, PageHeader, Select, Spinner, TextField } from '../../ui'
import { PacksSection } from './PacksSection'
import { StickerFormSheet } from './StickerFormSheet'

const IN_USE_MESSAGE = 'A child has earned this sticker — retire it instead'

function warningText(n: number): string | null {
  if (n >= 3) return null
  if (n === 0)
    return 'No stickers can be offered, so Sticker Picks will show fewer than 3 choices — a Gold Star will be given automatically instead.'
  return `Only ${n} ${n === 1 ? 'sticker' : 'stickers'} can be offered, so Sticker Picks will show fewer than 3 choices.`
}

function StickerCard({
  design,
  onEdit,
  onRetire,
  onActivate,
  onDelete,
}: {
  design: Design
  onEdit(): void
  onRetire(): void
  onActivate(): void
  onDelete(): void
}) {
  const retired = design.status === 'RETIRED'
  return (
    <li>
      <Card>
        <div className="flex h-full flex-col items-center gap-2 text-center" data-testid={`sticker-${design.id}`}>
          <div className={retired ? 'opacity-50 grayscale' : ''}>
            <Artwork artKey={design.artworkKey} size={88} decorative />
          </div>
          <h3 className="text-lg font-bold">{design.name}</h3>
          <p className="text-sm">{design.categoryName ?? 'No pack'}</p>
          <p
            className={`rounded-full px-3 py-0.5 text-sm font-bold ${retired ? 'bg-ink/10' : 'bg-mint'}`}
            data-testid="sticker-status"
          >
            {retired ? '⏸ Retired' : '✓ Active'}
          </p>
          <div className="mt-auto flex flex-wrap justify-center gap-2">
            <Button variant="secondary" aria-label={`Edit ${design.name}`} onClick={onEdit}>
              Edit
            </Button>
            {retired ? (
              <Button variant="secondary" aria-label={`Make ${design.name} active`} onClick={onActivate}>
                Make active
              </Button>
            ) : (
              <Button variant="secondary" aria-label={`Retire ${design.name}`} onClick={onRetire}>
                Retire
              </Button>
            )}
            {!design.inUse && (
              <Button variant="secondary" aria-label={`Delete ${design.name}`} onClick={onDelete}>
                Delete
              </Button>
            )}
          </div>
          {design.inUse && <p className="text-sm">{IN_USE_MESSAGE}</p>}
        </div>
      </Card>
    </li>
  )
}

export default function LibraryScreen() {
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<'' | DesignStatus>('')
  const [categoryId, setCategoryId] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 250)
    return () => clearTimeout(t)
  }, [search])

  const library = useLibrary({
    q: q || undefined,
    status: status || undefined,
    categoryId: categoryId ? Number(categoryId) : undefined,
  })
  const categories = useCategories()
  const setStatusMut = useSetDesignStatus()
  const del = useDeleteDesign()

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Design | null>(null)
  const [retiring, setRetiring] = useState<Design | null>(null)
  const [deleting, setDeleting] = useState<Design | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const packs = categories.data ?? []
  const designs = library.data?.designs ?? []
  const warning = library.data ? warningText(library.data.activeCount) : null

  const closeForm = () => {
    setFormOpen(false)
    setEditing(null)
  }

  return (
    <main data-testid="screen-library-screen" className="mx-auto max-w-5xl p-4 text-ink">
      <PageHeader
        title="Sticker Library"
        actions={
          <Button
            onClick={() => {
              setEditing(null)
              setFormOpen(true)
            }}
          >
            Add sticker
          </Button>
        }
      />
      <p className="mb-4 text-lg">One library for all children. Every child picks from the same active stickers.</p>

      {warning && (
        <div role="alert" className="mb-4 rounded-2xl border-4 border-ink bg-sunshine p-4 text-lg font-bold">
          <span aria-hidden="true">⚠️ </span>
          {warning}
        </div>
      )}

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <TextField
          label="Search stickers"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value as '' | DesignStatus)}>
          <option value="">All</option>
          <option value="ACTIVE">Active</option>
          <option value="RETIRED">Retired</option>
        </Select>
        <Select label="Pack" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">All packs</option>
          {packs.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>

      {library.isPending ? (
        <div className="flex justify-center p-8">
          <Spinner />
        </div>
      ) : library.isError ? (
        <FieldError message="We could not load the library. Please try again." />
      ) : designs.length === 0 ? (
        <EmptyState icon="🔍" title="No stickers found" message="Try a different search or filter, or add a new sticker." />
      ) : (
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4" aria-label="Stickers">
          {designs.map((d) => (
            <StickerCard
              key={d.id}
              design={d}
              onEdit={() => {
                setEditing(d)
                setFormOpen(true)
              }}
              onRetire={() => setRetiring(d)}
              onActivate={() => setStatusMut.mutate({ designId: d.id, status: 'ACTIVE' })}
              onDelete={() => {
                setDeleteError(null)
                setDeleting(d)
              }}
            />
          ))}
        </ul>
      )}

      <PacksSection packs={packs} />

      <StickerFormSheet open={formOpen} design={editing} categories={packs} onClose={closeForm} />

      <ConfirmDialog
        open={retiring !== null}
        title={`Retire ${retiring?.name ?? 'sticker'}?`}
        message="Retired stickers are never offered in a Sticker Pick, but stay in Sticker Books."
        confirmLabel="Retire"
        busy={setStatusMut.isPending}
        onCancel={() => setRetiring(null)}
        onConfirm={() => {
          if (!retiring) return
          setStatusMut.mutate({ designId: retiring.id, status: 'RETIRED' }, { onSettled: () => setRetiring(null) })
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        title={`Delete ${deleting?.name ?? 'sticker'}?`}
        message={
          <>
            <p>This removes the sticker from the library for good.</p>
            <FieldError message={deleteError ?? undefined} />
          </>
        }
        danger
        busy={del.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) return
          del.mutate(
            { designId: deleting.id },
            {
              onSuccess: () => setDeleting(null),
              onError: (e) =>
                setDeleteError(isApiError(e, 'DESIGN_IN_USE') ? IN_USE_MESSAGE : 'Something went wrong. Please try again.'),
            },
          )
        }}
      />
    </main>
  )
}
