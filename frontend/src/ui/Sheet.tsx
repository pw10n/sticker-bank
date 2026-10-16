import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export type SheetProps = {
  open: boolean
  onClose(): void
  title: string
  children: ReactNode
  footer?: ReactNode
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

export function Sheet({ open, onClose, title, children, footer }: SheetProps) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = dialogRef.current
    const first = dialog?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? dialog)?.focus()
    return () => {
      previous?.focus()
    }
  }, [open])

  if (!open) return null

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onCloseRef.current()
      return
    }
    if (e.key !== 'Tab') return
    const dialog = dialogRef.current
    if (!dialog) return
    const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE))
    if (items.length === 0) {
      e.preventDefault()
      dialog.focus()
      return
    }
    const firstEl = items[0]
    const lastEl = items[items.length - 1]
    const active = document.activeElement
    if (e.shiftKey && (active === firstEl || active === dialog)) {
      e.preventDefault()
      lastEl.focus()
    } else if (!e.shiftKey && active === lastEl) {
      e.preventDefault()
      firstEl.focus()
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div data-testid="sheet-backdrop" className="absolute inset-0 bg-ink/50" onClick={() => onCloseRef.current()} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="relative flex max-h-[90vh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-t-[2rem] bg-paper p-6 text-ink shadow-2xl outline-none sm:rounded-[2rem]"
      >
        <h2 id={titleId} className="text-2xl font-bold">
          {title}
        </h2>
        <div>{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
