import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useNavigate, useParams } from 'react-router'
import { z } from 'zod'
import { useChildren, useCreateChild, useDeleteChild, useUpdateChild } from '../../api/hooks'
import { isApiError } from '../../api/errors'
import type { Child } from '../../api/types'
import { PALETTE } from '../../app/palette'
import { ArtworkPicker } from '../../artwork'
import { Button, Card, ColorSwatchPicker, ConfirmDialog, FieldError, PageHeader, Spinner, TextField } from '../../ui'

const schema = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(40, 'Use 40 characters or fewer'),
  avatarKey: z.string().min(1, 'Pick a picture'),
  themeColor: z.string().min(1, 'Pick a color'),
})
type FormValues = z.infer<typeof schema>

export default function ChildEditScreen() {
  const { childId: param } = useParams()
  const isNew = param === 'new'
  const id = isNew ? null : Number(param)
  const children = useChildren()

  if (!isNew && (id === null || !Number.isFinite(id))) {
    return <NotFound />
  }
  if (isNew) return <ChildForm child={null} />
  if (children.isPending) {
    return (
      <main data-testid="screen-child-edit-screen" className="mx-auto max-w-2xl p-4">
        <Spinner label="Loading child" />
      </main>
    )
  }
  const child = children.data?.find((c) => c.id === id)
  if (!child) return <NotFound />
  return <ChildForm key={child.id} child={child} />
}

function NotFound() {
  return (
    <main data-testid="screen-child-edit-screen" className="mx-auto max-w-2xl p-4">
      <PageHeader title="Child not found" back={{ to: '/parent/children' }} />
      <p>We couldn't find that child.</p>
    </main>
  )
}

function ChildForm({ child }: { child: Child | null }) {
  const navigate = useNavigate()
  const create = useCreateChild()
  const update = useUpdateChild(child?.id ?? 0)
  const del = useDeleteChild()
  const [confirming, setConfirming] = useState(false)
  const [generalError, setGeneralError] = useState<string | null>(null)

  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: child?.name ?? '',
      avatarKey: child?.avatarKey ?? '',
      themeColor: child?.themeColor ?? PALETTE[0].hex,
    },
  })

  const saving = create.isPending || update.isPending

  const onError = (e: unknown) => {
    const fieldErrors = isApiError(e) ? e.problem?.fieldErrors : undefined
    let handled = false
    for (const fe of fieldErrors ?? []) {
      if (fe.field === 'name' || fe.field === 'avatarKey' || fe.field === 'themeColor') {
        setError(fe.field, { message: fe.message })
        handled = true
      }
    }
    if (!handled) setGeneralError("Couldn't save. Please try again.")
  }

  const onSubmit = (values: FormValues) => {
    setGeneralError(null)
    const body = { name: values.name.trim(), avatarKey: values.avatarKey, themeColor: values.themeColor }
    if (child) {
      update.mutate(body, { onSuccess: () => void navigate('/parent/children'), onError })
    } else {
      create.mutate(body, {
        onSuccess: (created) => void navigate(`/parent/children/${created.id}/routines`),
        onError,
      })
    }
  }

  const confirmDelete = () => {
    if (!child) return
    del.mutate(
      { childId: child.id },
      {
        onSuccess: () => void navigate('/parent/children'),
        onError: () => {
          setConfirming(false)
          setGeneralError("Couldn't delete. Please try again.")
        },
      },
    )
  }

  return (
    <main data-testid="screen-child-edit-screen" className="mx-auto flex max-w-2xl flex-col gap-4 p-4">
      <PageHeader title={child ? `Edit ${child.name}` : 'Add a child'} back={{ to: '/parent/children' }} />
      <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} noValidate className="flex flex-col gap-6">
        <Card className="flex flex-col gap-6">
          <TextField label="Name" autoComplete="off" error={errors.name?.message} {...register('name')} />
          <div>
            <Controller
              control={control}
              name="avatarKey"
              render={({ field }) => (
                <ArtworkPicker use="avatar" label="Picture" value={field.value || null} onChange={field.onChange} />
              )}
            />
            <FieldError message={errors.avatarKey?.message} />
          </div>
          <div>
            <Controller
              control={control}
              name="themeColor"
              render={({ field }) => (
                <ColorSwatchPicker
                  label="Theme color"
                  value={field.value || null}
                  onChange={(hex) => field.onChange(hex ?? '')}
                />
              )}
            />
            <FieldError message={errors.themeColor?.message} />
          </div>
        </Card>
        {generalError && <p role="alert" className="font-bold">{generalError}</p>}
        <div className="flex flex-wrap gap-3">
          <Button type="submit" size="lg" loading={saving}>
            Save
          </Button>
          {child && (
            <Button variant="danger" size="lg" onClick={() => setConfirming(true)}>
              Delete child
            </Button>
          )}
        </div>
      </form>
      {child && (
        <ConfirmDialog
          open={confirming}
          danger
          busy={del.isPending}
          title={`Delete ${child.name}?`}
          message={`Delete ${child.name}? This removes ${child.name}'s routines, stickers, history and prize requests. This can't be undone.`}
          confirmLabel="Delete"
          onConfirm={confirmDelete}
          onCancel={() => setConfirming(false)}
        />
      )}
    </main>
  )
}
