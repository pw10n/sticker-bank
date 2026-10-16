import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { isApiError } from '../../api/errors'
import {
  useCreateCategory,
  useDeleteCategory,
  useUpdateCategory,
} from '../../api/hooks'
import type { Category } from '../../api/types'
import { Button, Card, ConfirmDialog, FieldError, Sheet, TextField, Toggle } from '../../ui'

const schema = z.object({ name: z.string().trim().min(1, 'Give the pack a name').max(40, 'Use 40 letters or fewer') })
type FormValues = z.infer<typeof schema>

function PackFormSheet({ open, pack, onClose }: { open: boolean; pack: Category | null; onClose(): void }) {
  const create = useCreateCategory()
  const update = useUpdateCategory()
  const {
    register,
    handleSubmit,
    reset,
    setError,
    clearErrors,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { name: '' } })

  useEffect(() => {
    if (open) {
      reset({ name: pack?.name ?? '' })
    }
  }, [open, pack, reset])

  const busy = create.isPending || update.isPending
  const onSubmit = handleSubmit(async (values) => {
    clearErrors()
    const name = values.name.trim()
    try {
      if (pack) await update.mutateAsync({ categoryId: pack.id, input: { name, enabled: pack.enabled } })
      else await create.mutateAsync({ name, enabled: true })
      onClose()
    } catch (e) {
      const fe = isApiError(e) ? e.problem?.fieldErrors : undefined
      if (fe && fe.length > 0) {
        const nameErr = fe.find((f) => f.field === 'name')
        if (nameErr) setError('name', { message: nameErr.message })
        else setError('root', { message: fe[0].message })
      } else setError('root', { message: 'Something went wrong. Please try again.' })
    }
  })

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={pack ? 'Rename pack' : 'Add pack'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="pack-form" loading={busy}>
            {pack ? 'Save pack' : 'Add pack'}
          </Button>
        </>
      }
    >
      <form id="pack-form" onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <TextField label="Pack name" autoComplete="off" error={errors.name?.message} {...register('name')} />
        <FieldError message={errors.root?.message} />
      </form>
    </Sheet>
  )
}

export function PacksSection({ packs }: { packs: Category[] }) {
  const update = useUpdateCategory()
  const del = useDeleteCategory()
  const [editing, setEditing] = useState<Category | null>(null)
  const [adding, setAdding] = useState(false)
  const [deleting, setDeleting] = useState<Category | null>(null)

  return (
    <section aria-labelledby="packs-heading" className="mt-10">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 id="packs-heading" className="flex-1 text-2xl font-bold">
          Packs
        </h2>
        <Button variant="secondary" onClick={() => setAdding(true)}>
          Add pack
        </Button>
      </div>
      {packs.length === 0 ? (
        <p className="text-lg">No packs yet. Packs let you turn groups of stickers on or off together.</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {packs.map((p) => (
            <li key={p.id}>
              <Card>
                <div className="flex flex-col gap-3" data-testid={`pack-${p.id}`}>
                  <div>
                    <h3 className="text-xl font-bold">{p.name}</h3>
                    <p className="text-base">
                      {p.designCount} {p.designCount === 1 ? 'sticker' : 'stickers'}
                    </p>
                  </div>
                  <Toggle
                    label={`${p.name} pack ${p.enabled ? 'on' : 'off'}`}
                    description="Turn the whole pack on or off"
                    checked={p.enabled}
                    onChange={(enabled) => update.mutate({ categoryId: p.id, input: { name: p.name, enabled } })}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" aria-label={`Rename ${p.name} pack`} onClick={() => setEditing(p)}>
                      Rename
                    </Button>
                    <Button variant="secondary" aria-label={`Delete ${p.name} pack`} onClick={() => setDeleting(p)}>
                      Delete
                    </Button>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <PackFormSheet open={adding || editing !== null} pack={editing} onClose={() => { setAdding(false); setEditing(null) }} />
      <ConfirmDialog
        open={deleting !== null}
        title="Delete pack?"
        message={`Delete the ${deleting?.name ?? ''} pack? Its stickers stay in the library, just without a pack.`}
        danger
        busy={del.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) return
          del.mutate({ categoryId: deleting.id }, { onSettled: () => setDeleting(null) })
        }}
      />
    </section>
  )
}
