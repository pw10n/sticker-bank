import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { Button, Sheet, TextArea, TextField } from '../../ui'

const schema = z.object({
  prizeText: z.string().trim().min(1, 'Please say what prize was given').max(200, 'Please use 200 letters or fewer'),
  note: z.string().max(500, 'Please use 500 letters or fewer'),
})
type Values = z.infer<typeof schema>

export function PrizeFormSheet({
  title,
  submitLabel,
  initial,
  busy,
  error,
  onSubmit,
  onClose,
}: {
  title: string
  submitLabel: string
  initial?: { prizeText: string; note: string }
  busy: boolean
  error?: string | null
  onSubmit(v: { prizeText: string; note?: string }): void
  onClose(): void
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: initial ?? { prizeText: '', note: '' },
  })
  const submit = handleSubmit((v) => onSubmit({ prizeText: v.prizeText.trim(), note: v.note.trim() || undefined }))
  return (
    <Sheet
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Close
          </Button>
          <Button onClick={() => void submit()} loading={busy}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <TextField
          label="What prize did you give?"
          placeholder="Ice cream after dinner"
          error={errors.prizeText?.message}
          {...register('prizeText')}
        />
        <TextArea label="Note (optional)" error={errors.note?.message} {...register('note')} />
        {error && (
          <p role="alert" className="font-bold">
            {error}
          </p>
        )}
      </form>
    </Sheet>
  )
}
