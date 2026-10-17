import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'

const CONTROL =
  'w-full min-h-11 rounded-2xl border-2 border-ink/30 bg-white px-4 py-2 text-lg text-ink focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-ink aria-[invalid=true]:border-strawberry'

// WebKit ignores min-height on a native <select>, so drop the native look, set an explicit
// 44 px height and draw the chevron as a background image (the element stays a real <select>).
const SELECT_EXTRA =
  "h-11 appearance-none bg-[url(data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20width=%2716%27%20height=%2710%27%20viewBox=%270%200%2016%2010%27%3E%3Cpath%20d=%27M2%202l6%206%206-6%27%20fill=%27none%27%20stroke=%27%231b1b2f%27%20stroke-width=%272.5%27%20stroke-linecap=%27round%27%20stroke-linejoin=%27round%27/%3E%3C/svg%3E)] bg-[length:16px_10px] bg-[position:right_1rem_center] bg-no-repeat pr-11"

export function FieldError({ message, id }: { message?: string; id?: string }) {
  if (!message) return null
  return (
    <p id={id} role="alert" className="mt-1 flex items-center gap-1 text-base font-bold text-ink">
      <span aria-hidden="true">⚠️</span>
      {message}
    </p>
  )
}

function Field({ label, htmlFor, hint, hintId, error, errorId, children }: {
  label: string
  htmlFor: string
  hint?: string
  hintId: string
  error?: string
  errorId: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-base font-bold">
        {label}
      </label>
      {children}
      {hint && (
        <p id={hintId} className="text-sm">
          {hint}
        </p>
      )}
      <FieldError message={error} id={errorId} />
    </div>
  )
}

export type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string }

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, error, hint, className = '', id, ...rest },
  ref,
) {
  const auto = useId()
  const fid = id ?? auto
  return (
    <Field label={label} htmlFor={fid} hint={hint} hintId={`${fid}-hint`} error={error} errorId={`${fid}-error`}>
      <input
        ref={ref}
        id={fid}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hint ? `${fid}-hint` : '', error ? `${fid}-error` : ''].filter(Boolean).join(' ') || undefined}
        className={`${CONTROL} ${className}`}
        {...rest}
      />
    </Field>
  )
})

export type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; error?: string; hint?: string }

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { label, error, hint, className = '', id, ...rest },
  ref,
) {
  const auto = useId()
  const fid = id ?? auto
  return (
    <Field label={label} htmlFor={fid} hint={hint} hintId={`${fid}-hint`} error={error} errorId={`${fid}-error`}>
      <textarea
        ref={ref}
        id={fid}
        rows={3}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hint ? `${fid}-hint` : '', error ? `${fid}-error` : ''].filter(Boolean).join(' ') || undefined}
        className={`${CONTROL} ${className}`}
        {...rest}
      />
    </Field>
  )
})

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { label: string; error?: string; hint?: string }

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, error, hint, className = '', id, children, ...rest },
  ref,
) {
  const auto = useId()
  const fid = id ?? auto
  return (
    <Field label={label} htmlFor={fid} hint={hint} hintId={`${fid}-hint`} error={error} errorId={`${fid}-error`}>
      <select
        ref={ref}
        id={fid}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hint ? `${fid}-hint` : '', error ? `${fid}-error` : ''].filter(Boolean).join(' ') || undefined}
        className={`${CONTROL} ${SELECT_EXTRA} ${className}`}
        {...rest}
      >
        {children}
      </select>
    </Field>
  )
})

export function Toggle({ label, checked, onChange, description }: {
  label: string
  checked: boolean
  onChange(checked: boolean): void
  description?: string
}) {
  const id = useId()
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-col">
        <span id={`${id}-label`} className="text-base font-bold">
          {label}
        </span>
        {description && (
          <span id={`${id}-desc`} className="text-sm">
            {description}
          </span>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={description ? `${id}-desc` : undefined}
        onClick={() => onChange(!checked)}
        className={`relative flex h-11 w-20 shrink-0 items-center rounded-full border-2 border-ink px-1 touch-manipulation focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-ink ${
          checked ? 'justify-end bg-mint' : 'justify-start bg-white'
        }`}
      >
        <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-ink bg-white text-sm">
          {checked ? '✓' : ''}
        </span>
      </button>
    </div>
  )
}
