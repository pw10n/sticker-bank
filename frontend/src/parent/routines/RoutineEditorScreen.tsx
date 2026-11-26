import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { Controller, FormProvider, useForm, useWatch } from 'react-hook-form'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { z } from 'zod'
import { useCreateRoutine, useRoutine, useSaveRoutine } from '../../api/hooks'
import { isApiError } from '../../api/errors'
import type { Routine, RoutineInput, Weekday } from '../../api/types'
import { ArtworkPicker, artworkForUse } from '../../artwork'
import {
  Button,
  Card,
  ColorSwatchPicker,
  FieldError,
  PageHeader,
  Spinner,
  TextField,
  Toggle,
  WeekdayPicker,
} from '../../ui'
import { ALL_DAYS } from './schedule'
import { TaskRowsEditor } from '../shared/TaskRowsEditor'

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
  const create = useCreateRoutine(childId)
  const save = useSaveRoutine(routine?.id ?? 0)
  const listPath = `/parent/children/${childId}/routines`
  const defaultRoutineIcon = artworkForUse('routine')[0]?.key ?? ''

  const [generalError, setGeneralError] = useState<string | null>(null)

  const form = useForm<FormValues>({
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
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = form
  const tasks = useWatch({ control, name: 'tasks' })
  const taskCount = tasks?.length ?? 0

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
    // Saving never earns a sticker: if the edit leaves every task done, the routine is just Ready to finish (I-3).
    const done = (result: { appliesFromTomorrow: boolean }) => {
      const notices: string[] = []
      if (result.appliesFromTomorrow) notices.push("Today's sticker is already earned. Your changes start tomorrow.")
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
      <FormProvider {...form}>
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
            <TaskRowsEditor max={MAX_TASKS} />
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
      </FormProvider>
    </main>
  )
}
