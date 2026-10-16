import type { ButtonHTMLAttributes } from 'react'
import { Spinner } from './Spinner'

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  size?: 'md' | 'lg' | 'xl'
  loading?: boolean
}

const VARIANTS = {
  primary: 'bg-sunshine text-ink shadow-[0_4px_0_rgba(27,27,47,0.25)] hover:brightness-105',
  secondary: 'bg-white text-ink border-2 border-ink/30 shadow-[0_3px_0_rgba(27,27,47,0.12)]',
  danger: 'bg-strawberry text-ink shadow-[0_4px_0_rgba(27,27,47,0.25)]',
  ghost: 'bg-transparent text-ink underline-offset-4',
}
const SIZES = {
  md: 'min-h-11 px-5 text-base',
  lg: 'min-h-14 px-6 text-lg',
  xl: 'min-h-[72px] px-8 text-2xl',
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  type = 'button',
  className = '',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-2xl font-bold transition active:translate-y-0.5 active:shadow-none disabled:opacity-60 focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-ink touch-manipulation ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    >
      {loading && <Spinner label="Loading" />}
      {children}
    </button>
  )
}
