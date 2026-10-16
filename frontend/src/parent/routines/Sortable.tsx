import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { ReactNode } from 'react'

export type SortableId = string | number

/** Vertical sortable list with pointer, touch and keyboard sensors. */
export function SortableList({
  ids,
  onReorder,
  children,
}: {
  ids: SortableId[]
  onReorder(from: number, to: number): void
  children: ReactNode
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return
    const from = ids.indexOf(e.active.id as SortableId)
    const to = ids.indexOf(e.over.id as SortableId)
    if (from >= 0 && to >= 0) onReorder(from, to)
  }
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  )
}

/** A sortable row; `children` receives a drag handle to place wherever it fits. */
export function SortableRow({
  id,
  handleLabel,
  className = '',
  children,
}: {
  id: SortableId
  handleLabel: string
  className?: string
  children(handle: ReactNode): ReactNode
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id })
  const handle = (
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      aria-label={handleLabel}
      className="inline-flex h-11 w-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-full border-2 border-ink/20 bg-white text-xl focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-ink"
    >
      <span aria-hidden="true">⠿</span>
    </button>
  )
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`${isDragging ? 'relative z-10 opacity-80' : ''} ${className}`}
    >
      {children(handle)}
    </li>
  )
}
