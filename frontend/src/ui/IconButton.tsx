import type { ButtonHTMLAttributes, ReactNode } from 'react'

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  label: string
  icon: ReactNode
  size?: 'md' | 'lg'
}

export function IconButton({ label, icon, size = 'md', className = '', type = 'button', ...rest }: IconButtonProps) {
  const dim = size === 'lg' ? 'h-[72px] w-[72px] text-3xl' : 'h-11 w-11 text-xl'
  return (
    <button
      type={type}
      aria-label={label}
      className={`inline-flex items-center justify-center rounded-full bg-white text-ink shadow-[0_3px_0_rgba(27,27,47,0.15)] border-2 border-ink/20 transition active:translate-y-0.5 disabled:opacity-60 focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-ink touch-manipulation ${dim} ${className}`}
      {...rest}
    >
      <span aria-hidden="true">{icon}</span>
    </button>
  )
}
