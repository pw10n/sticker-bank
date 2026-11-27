import { useState } from 'react'
import { useFieldArray, useFormContext, useWatch } from 'react-hook-form'
import { Artwork, ArtworkPicker, artworkForUse } from '../../artwork'
import { Button, Card, IconButton, Sheet, TextField } from '../../ui'
import { SortableList, SortableRow } from '../routines/Sortable'

/** The part of a form that TaskRowsEditor edits. The surrounding form must be wrapped in a react-hook-form FormProvider. */
export interface TaskRowsFormShape {
  tasks: { taskId?: number; label: string; iconKey: string }[]
}

export interface TaskRowsEditorProps {
  /** Maximum number of task rows. */
  max: number
}

export function TaskRowsEditor({ max }: TaskRowsEditorProps) {
  const {
    register,
    control,
    setValue,
    formState: { errors },
  } = useFormContext<TaskRowsFormShape>()
  const { fields, append, remove, move } = useFieldArray({ control, name: 'tasks' })
  const tasks = useWatch({ control, name: 'tasks' })
  const [pickerIndex, setPickerIndex] = useState<number | null>(null)
  const defaultTaskIcon = artworkForUse('task')[0]?.key ?? ''
  const taskErrors = errors.tasks

  return (
    <>
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
          disabled={fields.length >= max}
          onClick={() => append({ label: '', iconKey: defaultTaskIcon })}
        >
          Add task
        </Button>
        {fields.length >= max && <p className="mt-1 text-sm">You can add up to {max} tasks.</p>}
      </div>

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
    </>
  )
}
