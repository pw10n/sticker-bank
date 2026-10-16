import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { z } from 'zod'
import { useChildren, useCreateRoutine, useRoutine, useSaveRoutine } from '../../api/hooks'
import { isApiError } from '../../api/errors'
import type { Routine, RoutineInput, Weekday } from '../../api/types'
import { Artwork, ArtworkPicker, artworkForUse } from '../../artwork'
import {
  Button,
  Card,
  ColorSwatchPicker,
  FieldError,
  IconButton,
  PageHeader,
  Sheet,
  Spinner,
  TextField,
  Toggle,
  WeekdayPicker,
} from '../../ui'
import { ALL_DAYS } from './schedule'
import { SortableList, SortableRow } from './Sortable'

const MAX_TASKS = 30
const DAYS_MESSAGE = 'Pick at least one day — use Pause to switch a routine off'
const WEEKDAY = z.enum(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'])

const schema = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(60, 'Use 60 characters or fewer'),
  iconKey: z.string().min(1, 'Pick a picture'),
  color: z.string().nullable(),
  days: z.array(WEEKDAY).min(1, DAYS_MESSAGE),
  paused: z.boolean(),
  tasks: z
    .array(
      z.object({
        taskId: z.number().optional(),
        label: z.string().trim().min(1, 'Enter a name for this task').max(60, 'Use 60 characters or fewer'),
        iconKey: z.string().min(1, 'Pick a picture'),
      }),
    )
    .max(MAX_TASKS, `Use ${MAX_TASKS} tasks or fewer`),
})
type FormValues = z.infer<typeof schema>

export default function RoutineEditorScreen() {
  const { routineId: param } = useParams()
  const [search] = useSearchParams()
  const isNew = param === 'new'
  const routineId = isNew ? null : Number(param)
  const routine = useRoutine(routineId !== null && Number.isFinite(routineId) ? routineId : null)

  if (isNew) {
    const childId = Number(search.get('childId'))
    if (!Number.isFinite(childId) || childId <= 0) return <Message text="Choose a child first to add a routine." />
    return <RoutineForm childId={childId} routine={null} />
  }
  if (routine.isPending && routine.fetchStatus !== 'idle') {
    return (
      <main data-testid="screen-routine-editor-screen" className="mx-auto max-w-2xl p-4">
        <Spinner label="Loading routine" />
      </main>
    )
  }
  if (!routine.data) return <Message text="We couldn't find that routine." />
  return <RoutineForm key={routine.data.id} childId={routine.data.childId} routine={routine.data} />
}

function Message({ text }: { text: string }) {
  return (
    <main data-testid="screen-routine-editor-screen" className="mx-auto max-w-2xl p-4">
      <PageHeader title="Routine" back={{ to: '/parent/children' }} />
      <p>{text}</p>
    </main>
  )
}

const ROOT_FIELDS = ['name', 'iconKey', 'color', 'days', 'paused', 'tasks']

function RoutineForm({ childId, routine }: { childId: number; routine: Routine | null }) {
  const navigate = useNavigate()
  const children = useChildren()
  const create = useCreateRoutine(childId)
  const save = useSaveRoutine(routine?.id ?? 0)
  const childName = children.data?.find((c) => c.id === childId)?.name ?? 'Your child'
  const listPath = `/parent/children/${childId}/routines`
  const defaultTaskIcon = artworkForUse('task')[0]?.key ?? ''
  const defaultRoutineIcon = artworkForUse('routine')[0]?.key ?? ''

  const [pickerIndex, setPickerIndex] = useState<number | null>(null)
  const [generalError, setGeneralError] = useState<string | null>(null)

  const {
    register,
    control,
    handleSubmit,
    setError,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: routine?.name ?? '',
      iconKey: routine?.iconKey ?? defaultRoutineIcon,
      color: routine?.color ?? null,
      days: routine ? routine.days : ALL_DAYS,
      paused: routine?.paused ?? false,
      tasks: (routine?.tasks ?? [])
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((t) => ({ taskId: t.id, label: t.label, iconKey: t.iconKey })),
    },
  })
  const { fields, append, remove, move } = useFieldArray({ control, name: 'tasks' })
  const tasks = useWatch({ control, name: 'tasks' })
  const taskCount = tasks?.length ?? fields.length

  const onServerError = (e: unknown) => {
    const fieldErrors = isApiError(e) ? e.problem?.fieldErrors : undefined
    let handled = false
    for (const fe of fieldErrors ?? []) {
      const path = fe.field.replace(/\[(\d+)\]/g, '.$1')
      if (!ROOT_FIELDS.includes(path.split('.')[0])) continue
      setError(path as `tasks.${number}.label`, { message: fe.message })
      handled = true
    }
    if (!handled) setGeneralError("Couldn't save. Please try again.")
  }

  const onSubmit = (values: FormValues) => {
    setGeneralError(null)
    const body: RoutineInput = {
      name: values.name.trim(),
      iconKey: values.iconKey,
      color: values.color,
      days: values.days as Weekday[],
      paused: values.paused,
      tasks: values.tasks.map((t) => ({
        ...(t.taskId !== undefined ? { id: t.taskId } : {}),
        label: t.label.trim(),
        iconKey: t.iconKey,
      })),
    }
    const done = (result: { appliesFromTomorrow: boolean; earnedPick: unknown }) => {
      const notices: string[] = []
      if (result.appliesFromTomorrow) notices.push("Today's sticker is already earned. Your changes start tomorrow.")
      if (result.earnedPick) notices.push(`All of today's tasks are done now, so ${childName} earned a sticker!`)
      void navigate(listPath, { state: notices.length ? { notice: notices.join(' ') } : undefined })
    }
    if (routine) save.mutate(body, { onSuccess: done, onError: onServerError })
    else create.mutate(body, { onSuccess: done, onError: onServerError })
  }

  const taskErrors = errors.tasks
  const saving = create.isPending || save.isPending

  return (
    <main data-testid="screen-routine-editor-screen" className="mx-auto flex max-w-2xl flex-col gap-4 p-4">
      <PageHeader title={routine ? 'Edit routine' : 'New routine'} back={{ to: listPath, label: 'Routines' }} />
      <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} noValidate className="flex flex-col gap-6">
        <Card className="flex flex-col gap-6">
          <TextField label="Routine name" autoComplete="off" error={errors.name?.message} {...register('name')} />
          <div>
            <Controller
              control={control}
              name="iconKey"
              render={({ field }) => (
                <ArtworkPicker use="routine" label="Routine picture" value={field.value || null} onChange={field.onChange} />
              )}
            />
            <FieldError message={errors.iconKey?.message} />
          </div>
          <div>
            <Controller
              control={control}
              name="color"
              render={({ field }) => (
                <ColorSwatchPicker label="Color" allowNone value={field.value} onChange={field.onChange} />
              )}
            />
            <FieldError message={errors.color?.message} />
          </div>
          <div>
            <Controller
              control={control}
              name="days"
              render={({ field }) => <WeekdayPicker value={field.value as Weekday[]} onChange={field.onChange} />}
            />
            <FieldError message={errors.days?.message ?? errors.days?.root?.message} />
          </div>
          <Controller
            control={control}
            name="paused"
            render={({ field }) => (
              <Toggle label="Pause this routine (e.g. summer break)" checked={field.value} onChange={field.onChange} />
            )}
          />
        </Card>

        <section aria-labelledby="tasks-heading" className="flex flex-col gap-3">
          <h2 id="tasks-heading" className="text-2xl font-bold">
            Tasks
          </h2>
          {taskCount === 0 && (
            <p role="status" className="rounded-2xl border-2 border-ink/20 bg-sand/40 px-4 py-3 font-bold">
              Add at least one task so this routine shows on the chart
            </p>
          )}
          <FieldError message={typeof taskErrors?.message === 'string' ? taskErrors.message : taskErrors?.root?.message} />
          <SortableList ids={fields.map((f) => f.id)} onReorder={move}>
            <ul className="flex flex-col gap-3">
              {fields.map((field, i) => (
                <SortableRow key={field.id} id={field.id} handleLabel={`Drag to reorder task ${i + 1}`}>
                  {(handle) => (
                    <Card>
                      <div className="flex items-start gap-2">
                        {handle}
                        <button
                          type="button"
                          aria-label={`Change picture for task ${i + 1}`}
                          onClick={() => setPickerIndex(i)}
                          className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border-2 border-ink/30 bg-white focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-ink"
                        >
                          <Artwork artKey={tasks?.[i]?.iconKey ?? field.iconKey} size={40} decorative />
                        </button>
                        <div className="min-w-0 flex-1">
                          <TextField
                            label={`Task ${i + 1}`}
                            autoComplete="off"
                            error={taskErrors?.[i]?.label?.message ?? taskErrors?.[i]?.iconKey?.message}
                            {...register(`tasks.${i}.label` as const)}
                          />
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap justify-end gap-2">
                        <IconButton label={`Move task ${i + 1} up`} icon="↑" disabled={i === 0} onClick={() => move(i, i - 1)} />
                        <IconButton
                          label={`Move task ${i + 1} down`}
                          icon="↓"
                          disabled={i === fields.length - 1}
                          onClick={() => move(i, i + 1)}
                        />
                        <IconButton label={`Remove task ${i + 1}`} icon="🗑" onClick={() => remove(i)} />
                      </div>
                    </Card>
                  )}
                </SortableRow>
              ))}
            </ul>
          </SortableList>
          <div>
            <Button
              variant="secondary"
              size="lg"
              disabled={fields.length >= MAX_TASKS}
              onClick={() => append({ label: '', iconKey: defaultTaskIcon })}
            >
              Add task
            </Button>
            {fields.length >= MAX_TASKS && <p className="mt-1 text-sm">You can add up to {MAX_TASKS} tasks.</p>}
          </div>
        </section>

        {generalError && (
          <p role="alert" className="font-bold">
            {generalError}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <Button type="submit" size="lg" loading={saving}>
            Save
          </Button>
        </div>
      </form>

      <Sheet
        open={pickerIndex !== null}
        onClose={() => setPickerIndex(null)}
        title="Pick a picture"
        footer={
          <Button variant="secondary" onClick={() => setPickerIndex(null)}>
            Close
          </Button>
        }
      >
        <ArtworkPicker
          use="task"
          label="task pictures"
          value={pickerIndex !== null ? (tasks?.[pickerIndex]?.iconKey ?? null) : null}
          onChange={(key) => {
            if (pickerIndex !== null) setValue(`tasks.${pickerIndex}.iconKey`, key, { shouldDirty: true, shouldValidate: true })
            setPickerIndex(null)
          }}
        />
      </Sheet>
    </main>
  )
}
