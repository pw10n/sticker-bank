import { zodResolver } from '@hookform/resolvers/zod'
import { useId, useRef, useState } from 'react'
import { Controller, FormProvider, useForm, useWatch } from 'react-hook-form'
import { z } from 'zod'
import { isApiError } from '../../api/errors'
import { useAssignChore, useBootstrap, useRecentChores, useSaveChore } from '../../api/hooks'
import type { Chore, ChoreInput } from '../../api/types'
import { Artwork, ArtworkPicker } from '../../artwork'
import { Button, FieldError, Sheet, Spinner, TextField, Toggle } from '../../ui'
import { addDays } from '../history/dates'
import { TaskRowsEditor } from '../shared/TaskRowsEditor'
import {
  MAX_CHORE_TASKS,
  awardedAtOnce,
  defaultChoreIcon,
  isSimpleChore,
  limitMessage,
  type TaskLike,
} from './choreUtils'
import { PickOffer } from './PickOffer'

export type ChoreFormMode =
  | {
      kind: 'assign'
      /** Children ticked when the form opens (used with two or more children). */
      childIds: number[]
      prefill?: { name: string; iconKey: string; tasks: TaskLike[] }
    }
  | { kind: 'edit'; chore: Chore; reopen?: boolean }

export interface ChoreFormSheetProps {
  mode: ChoreFormMode
  onClose(): void
  onSaved?(message: string): void
}

type Due = 'none' | 'today' | 'tomorrow' | 'date'

const ROOT_FIELDS = ['name', 'iconKey', 'dueDate', 'tasks']

function makeSchema(today: string, needChildren: boolean) {
  return z
    .object({
      name: z.string().trim().min(1, 'Enter a name').max(60, 'Use 60 characters or fewer'),
      iconKey: z.string().min(1, 'Pick a picture'),
      due: z.enum(['none', 'today', 'tomorrow', 'date']),
      dueDate: z.string(),
      alreadyDone: z.boolean(),
      childIds: z.array(z.number()),
      tasks: z
        .array(
          z.object({
            taskId: z.number().optional(),
            label: z.string().trim().min(1, 'Enter a name for this task').max(60, 'Use 60 characters or fewer'),
            iconKey: z.string().min(1, 'Pick a picture'),
          }),
        )
        .max(MAX_CHORE_TASKS, `Use ${MAX_CHORE_TASKS} tasks or fewer`),
    })
    .superRefine((v, ctx) => {
      if (!v.alreadyDone && v.due === 'date') {
        if (!v.dueDate) ctx.addIssue({ code: 'custom', path: ['dueDate'], message: 'Pick a date' })
        else if (v.dueDate < today)
          ctx.addIssue({ code: 'custom', path: ['dueDate'], message: 'Pick today or a later date' })
      }
      if (needChildren && v.childIds.length === 0)
        ctx.addIssue({ code: 'custom', path: ['childIds'], message: 'Pick at least one child' })
    })
}
type FormValues = z.infer<ReturnType<typeof makeSchema>>

function titleFor(mode: ChoreFormMode): string {
  if (mode.kind === 'assign') return 'Assign a chore'
  return mode.reopen ? 'Reopen chore' : 'Edit chore'
}

/** The sheet where a parent assigns, edits or reopens a chore. */
export function ChoreFormSheet(props: ChoreFormSheetProps) {
  const bootstrap = useBootstrap()
  if (!bootstrap.data) {
    return (
      <Sheet open onClose={props.onClose} title={titleFor(props.mode)} footer={<Button variant="secondary" onClick={props.onClose}>Cancel</Button>}>
        {bootstrap.isError ? <p role="alert">Could not load the children.</p> : <Spinner label="Loading" />}
      </Sheet>
    )
  }
  return <ChoreFormBody {...props} children={bootstrap.data.children} today={bootstrap.data.today} />
}

type ChildRef = { id: number; name: string }

interface Offer {
  childId: number
  childName: string
  choreName: string
  stickerId: number
  autoAwarded: boolean
}

function ChoreFormBody({
  mode,
  onClose,
  onSaved,
  children,
  today,
}: ChoreFormSheetProps & { children: ChildRef[]; today: string }) {
  const formId = useId()
  const assign = useAssignChore()
  const save = useSaveChore()
  const recent = useRecentChores()
  const editing = mode.kind === 'edit' ? mode.chore : null
  const showChildren = mode.kind === 'assign' && children.length >= 2
  const childName = (id: number) => children.find((c) => c.id === id)?.name ?? 'This child'

  const [pickerOpen, setPickerOpen] = useState(false)
  // Set synchronously when a submit starts and cleared when the whole submit ends, so a fast second click is ignored.
  const submittingRef = useRef(false)
  const [submitting, setSubmitting] = useState(false)
  const [generalError, setGeneralError] = useState<string | null>(null)
  const [failures, setFailures] = useState<string[]>([])
  const [assignedNote, setAssignedNote] = useState<string | null>(null)
  const [offer, setOffer] = useState<Offer | null>(null)
  const [schema] = useState(() => makeSchema(today, showChildren))

  // A chore whose only task repeats its own name and icon shows an empty list; its task id is kept for saving.
  const simpleTaskId =
    editing && isSimpleChore(editing.name, editing.iconKey, editing.tasks) ? editing.tasks[0].taskId : undefined

  const [defaults] = useState<FormValues>(() => {
    const base = { due: 'none' as Due, dueDate: '', alreadyDone: false }
    if (editing) {
      const simple = isSimpleChore(editing.name, editing.iconKey, editing.tasks)
      let due: Due = 'none'
      let dueDate = ''
      // A reopened chore starts on No due date: its old due date is past and can't be saved (BR-25).
      if (mode.kind === 'edit' && !mode.reopen) {
        if (editing.dueDate === today) due = 'today'
        else if (editing.dueDate === addDays(today, 1)) due = 'tomorrow'
        else if (editing.dueDate) {
          due = 'date'
          dueDate = editing.dueDate
        }
      }
      return {
        ...base,
        name: editing.name,
        iconKey: editing.iconKey,
        due,
        dueDate,
        childIds: [editing.childId],
        tasks: simple ? [] : editing.tasks.map((t) => ({ taskId: t.taskId, label: t.label, iconKey: t.iconKey })),
      }
    }
    const prefill = mode.kind === 'assign' ? mode.prefill : undefined
    const childIds = children.length === 1 ? [children[0].id] : mode.kind === 'assign' ? mode.childIds : []
    return {
      ...base,
      name: prefill?.name ?? '',
      iconKey: prefill?.iconKey ?? defaultChoreIcon(),
      childIds,
      tasks: prefill && !isSimpleChore(prefill.name, prefill.iconKey, prefill.tasks) ? prefill.tasks.map((t) => ({ ...t })) : [],
    }
  })

  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: defaults })
  const {
    register,
    control,
    handleSubmit,
    setError,
    setValue,
    formState: { errors },
  } = form
  const due = useWatch({ control, name: 'due' })
  const dueDate = useWatch({ control, name: 'dueDate' })
  const alreadyDone = useWatch({ control, name: 'alreadyDone' })
  const iconKey = useWatch({ control, name: 'iconKey' })
  const childIds = useWatch({ control, name: 'childIds' })

  const applyFieldErrors = (e: unknown): boolean => {
    const fieldErrors = isApiError(e) ? e.problem?.fieldErrors : undefined
    let handled = false
    for (const fe of fieldErrors ?? []) {
      const path = fe.field.replace(/\[(\d+)\]/g, '.$1')
      if (!ROOT_FIELDS.includes(path.split('.')[0])) continue
      setError(path as 'name', { message: fe.message })
      handled = true
    }
    return handled
  }

  const messageFor = (e: unknown, name: string): string => {
    if (isApiError(e, 'CHORE_LIMIT_REACHED')) return limitMessage(name)
    if (isApiError(e, 'CHORE_LOCKED')) return "This chore is already finished, so it can't be changed."
    if (isApiError(e, 'NOT_FOUND')) return 'That chore is gone. Please close this and look again.'
    return "Couldn't save. Please try again."
  }

  const fillFrom = (s: { name: string; iconKey: string; tasks: TaskLike[] }) => {
    setValue('name', s.name, { shouldDirty: true, shouldValidate: true })
    setValue('iconKey', s.iconKey, { shouldDirty: true })
    setValue(
      'tasks',
      isSimpleChore(s.name, s.iconKey, s.tasks) ? [] : s.tasks.map((t) => ({ label: t.label, iconKey: t.iconKey })),
      { shouldDirty: true },
    )
  }

  const onSubmit = async (values: FormValues) => {
    if (submittingRef.current) return
    submittingRef.current = true
    setSubmitting(true)
    try {
      await submit(values)
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  const submit = async (values: FormValues) => {
    setGeneralError(null)
    setFailures([])
    setAssignedNote(null)
    const name = values.name.trim()
    const dueValue = values.alreadyDone
      ? null
      : values.due === 'today'
        ? today
        : values.due === 'tomorrow'
          ? addDays(today, 1)
          : values.due === 'date'
            ? values.dueDate
            : null
    const tasks =
      values.tasks.length > 0
        ? values.tasks.map((t) => ({
            ...(t.taskId !== undefined ? { id: t.taskId } : {}),
            label: t.label.trim(),
            iconKey: t.iconKey,
          }))
        : [{ ...(simpleTaskId !== undefined ? { id: simpleTaskId } : {}), label: name, iconKey: values.iconKey }]
    const input: ChoreInput = {
      name,
      iconKey: values.iconKey,
      dueDate: dueValue,
      tasks,
      ...(mode.kind === 'assign' && values.alreadyDone ? { alreadyDone: true } : {}),
    }

    if (editing) {
      try {
        await save.mutateAsync({ choreId: editing.choreId, childId: editing.childId, input })
        onSaved?.(mode.kind === 'edit' && mode.reopen ? 'Chore reopened.' : 'Chore saved.')
        onClose()
      } catch (e) {
        if (isApiError(e, 'VALIDATION_FAILED') && applyFieldErrors(e)) return
        setGeneralError(messageFor(e, childName(editing.childId)))
      }
      return
    }

    const targets = children.length === 1 ? [children[0].id] : children.filter((c) => values.childIds.includes(c.id)).map((c) => c.id)
    const ok: number[] = []
    const lines: string[] = []
    let last: Chore | null = null
    let blocked = false
    for (const id of targets) {
      try {
        last = await assign.mutateAsync({ childId: id, input })
        ok.push(id)
      } catch (e) {
        // The same input fails the same way for every child, so stop at the first validation problem.
        if (isApiError(e, 'VALIDATION_FAILED') && applyFieldErrors(e)) {
          blocked = true
          break
        }
        const msg = messageFor(e, childName(id))
        lines.push(isApiError(e, 'CHORE_LIMIT_REACHED') || targets.length === 1 ? msg : `${childName(id)}: ${msg}`)
      }
    }
    if (lines.length === 0 && !blocked) {
      const names = ok.map(childName).join(', ')
      onSaved?.(`Assigned ${name} to ${names}.`)
      const sticker = last?.sticker ?? null
      if (values.alreadyDone && ok.length === 1 && last && sticker) {
        setOffer({
          childId: ok[0],
          childName: childName(ok[0]),
          choreName: last.name,
          stickerId: sticker.stickerId,
          autoAwarded: awardedAtOnce(sticker),
        })
        return
      }
      onClose()
      return
    }
    // The form stays open: untick the children that got the chore, so saving again cannot give them a second one.
    if (ok.length > 0 || lines.length > 0) {
      setValue(
        'childIds',
        targets.filter((id) => !ok.includes(id)),
      )
    }
    if (ok.length > 0) setAssignedNote(`Assigned to ${ok.map(childName).join(', ')}.`)
    setFailures(lines)
    if (ok.length > 0) onSaved?.(`Assigned ${name} to ${ok.map(childName).join(', ')}.`)
  }

  const saving = submitting

  if (offer) {
    return (
      <Sheet open onClose={onClose} title="Chore finished" footer={null}>
        <PickOffer {...offer} onDone={onClose} />
      </Sheet>
    )
  }

  const quick: { value: Due; label: string }[] = [
    { value: 'none', label: 'No due date' },
    { value: 'today', label: 'Today' },
    { value: 'tomorrow', label: 'Tomorrow' },
  ]

  return (
    <>
      <Sheet
        open
        onClose={saving ? () => {} : onClose}
        title={titleFor(mode)}
        footer={
          <>
            <Button variant="secondary" disabled={saving} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" form={formId} loading={saving}>
              Save
            </Button>
          </>
        }
      >
        <FormProvider {...form}>
          <form id={formId} noValidate onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="flex flex-col gap-5">
            {!editing && (recent.data?.length ?? 0) > 0 && (
              <section aria-labelledby={`${formId}-recent`}>
                <h3 id={`${formId}-recent`} className="mb-2 text-base font-bold">
                  Recent chores
                </h3>
                <ul className="flex flex-wrap gap-2">
                  {recent.data?.map((s, i) => (
                    <li key={`${s.name}-${i}`}>
                      <button
                        type="button"
                        data-testid="recent-chore"
                        onClick={() => fillFrom(s)}
                        className="inline-flex min-h-11 items-center gap-2 rounded-full border-2 border-ink/30 bg-white px-3 font-bold focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-ink"
                      >
                        <Artwork artKey={s.iconKey} size={24} decorative />
                        {s.name}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {showChildren && (
              <fieldset className="flex flex-col gap-1">
                <legend className="mb-1 text-base font-bold">Assign to</legend>
                {children.map((c) => (
                  <label key={c.id} className="flex min-h-11 items-center gap-3 font-bold">
                    <input
                      type="checkbox"
                      className="h-6 w-6"
                      checked={childIds.includes(c.id)}
                      onChange={(e) =>
                        setValue(
                          'childIds',
                          e.target.checked ? [...childIds, c.id] : childIds.filter((id) => id !== c.id),
                          { shouldValidate: true },
                        )
                      }
                    />
                    {c.name}
                  </label>
                ))}
                <FieldError message={errors.childIds?.message ?? errors.childIds?.root?.message} />
              </fieldset>
            )}

            <TextField label="Chore name" autoComplete="off" error={errors.name?.message} {...register('name')} />

            <div className="flex flex-col gap-1">
              <span className="text-base font-bold">Picture</span>
              <div>
                <button
                  type="button"
                  aria-label="Change picture"
                  onClick={() => setPickerOpen(true)}
                  className="inline-flex h-14 w-14 items-center justify-center rounded-2xl border-2 border-ink/30 bg-white focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-ink"
                >
                  <Artwork artKey={iconKey} size={40} decorative />
                </button>
              </div>
              <FieldError message={errors.iconKey?.message} />
            </div>

            {mode.kind === 'assign' && (
              <Controller
                control={control}
                name="alreadyDone"
                render={({ field }) => (
                  <Toggle
                    label="Done already"
                    description="Already finished? The sticker is earned right away."
                    checked={field.value}
                    onChange={field.onChange}
                  />
                )}
              />
            )}

            {!alreadyDone && (
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-base font-bold">Due date</legend>
                <div role="group" aria-label="Due date" className="flex flex-wrap gap-2">
                  {quick.map((q) => (
                    <button
                      key={q.value}
                      type="button"
                      aria-pressed={due === q.value}
                      onClick={() => setValue('due', q.value, { shouldValidate: true })}
                      className={`min-h-11 rounded-2xl border-2 border-ink/30 px-4 font-bold focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-ink ${
                        due === q.value ? 'bg-sunshine' : 'bg-white'
                      }`}
                    >
                      {q.label}
                    </button>
                  ))}
                </div>
                <TextField
                  label="Or pick a later date"
                  type="date"
                  min={today}
                  value={due === 'date' ? dueDate : ''}
                  error={errors.dueDate?.message}
                  onChange={(e) => {
                    setValue('dueDate', e.target.value, { shouldValidate: true })
                    setValue('due', e.target.value ? 'date' : 'none', { shouldValidate: true })
                  }}
                />
              </fieldset>
            )}

            <section aria-labelledby={`${formId}-tasks`} className="flex flex-col gap-3">
              <h3 id={`${formId}-tasks`} className="text-base font-bold">
                Tasks
              </h3>
              <p className="text-sm">Optional. With no tasks, the chore is one tile with its own name and picture.</p>
              <FieldError
                message={typeof errors.tasks?.message === 'string' ? errors.tasks.message : errors.tasks?.root?.message}
              />
              <TaskRowsEditor max={MAX_CHORE_TASKS} />
            </section>

            {assignedNote && (
              <p role="status" className="font-bold">
                {assignedNote}
              </p>
            )}
            {failures.map((f) => (
              <p key={f} role="alert" className="font-bold">
                {f}
              </p>
            ))}
            {generalError && (
              <p role="alert" className="font-bold">
                {generalError}
              </p>
            )}
          </form>
        </FormProvider>
      </Sheet>
      <Sheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Pick a picture"
        footer={
          <Button variant="secondary" onClick={() => setPickerOpen(false)}>
            Close
          </Button>
        }
      >
        <ArtworkPicker
          use="task"
          label="Chore pictures"
          value={iconKey || null}
          onChange={(key) => {
            setValue('iconKey', key, { shouldDirty: true, shouldValidate: true })
            setPickerOpen(false)
          }}
        />
      </Sheet>
    </>
  )
}
