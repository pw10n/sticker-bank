import { useEffect } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArtworkPicker } from '../../artwork'
import { isApiError } from '../../api/errors'
import { useCreateDesign, useUpdateDesign } from '../../api/hooks'
import type { Category, Design } from '../../api/types'
import { Button, FieldError, Select, Sheet, TextField } from '../../ui'

const schema = z.object({
  name: z.string().trim().min(1, 'Give the sticker a name').max(40, 'Use 40 letters or fewer'),
  artworkKey: z.string().min(1, 'Choose a picture'),
  categoryId: z.string(),
})
type FormValues = z.infer<typeof schema>

export function StickerFormSheet({
  open,
  design,
  categories,
  onClose,
}: {
  open: boolean
  design: Design | null
  categories: Category[]
  onClose(): void
}) {
  const create = useCreateDesign()
  const update = useUpdateDesign()
  const {
    register,
    handleSubmit,
    control,
    reset,
    setError,
    clearErrors,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', artworkKey: '', categoryId: '' },
  })

  useEffect(() => {
    if (open) {
      reset({
        name: design?.name ?? '',
        artworkKey: design?.artworkKey ?? '',
        categoryId: design?.categoryId != null ? String(design.categoryId) : '',
      })
    }
  }, [open, design, reset])

  const busy = create.isPending || update.isPending

  const onSubmit = handleSubmit(async (values) => {
    clearErrors()
    const input = {
      name: values.name.trim(),
      artworkKey: values.artworkKey,
      categoryId: values.categoryId === '' ? null : Number(values.categoryId),
    }
    try {
      if (design) await update.mutateAsync({ designId: design.id, input })
      else await create.mutateAsync(input)
      onClose()
    } catch (e) {
      const fields = isApiError(e) ? e.problem?.fieldErrors : undefined
      if (fields && fields.length > 0) {
        let matched = false
        for (const fe of fields) {
          if (fe.field === 'name' || fe.field === 'artworkKey' || fe.field === 'categoryId') {
            setError(fe.field, { message: fe.message })
            matched = true
          }
        }
        if (!matched) setError('root', { message: fields[0].message })
      } else {
        setError('root', { message: 'Something went wrong. Please try again.' })
      }
    }
  })

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={design ? 'Edit sticker' : 'Add sticker'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="sticker-form" loading={busy}>
            {design ? 'Save sticker' : 'Add sticker'}
          </Button>
        </>
      }
    >
      <form id="sticker-form" onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {design && (
          <p className="text-base">
            Changes show up everywhere, including stickers already in Sticker Books.
          </p>
        )}
        <TextField label="Name" autoComplete="off" error={errors.name?.message} {...register('name')} />
        <div>
          <Controller
            control={control}
            name="artworkKey"
            render={({ field }) => (
              <ArtworkPicker use="sticker" label="Choose a picture" value={field.value || null} onChange={field.onChange} />
            )}
          />
          <FieldError message={errors.artworkKey?.message} />
        </div>
        <Select label="Pack (optional)" error={errors.categoryId?.message} {...register('categoryId')}>
          <option value="">No pack</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <FieldError message={errors.root?.message} />
      </form>
    </Sheet>
  )
}
