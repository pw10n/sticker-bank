import type { ReactNode } from 'react'

export function Card({ children, className = '', accent }: { children: ReactNode; className?: string; accent?: string }) {
  return (
    <div
      style={accent ? { borderLeftColor: accent } : undefined}
      className={`rounded-3xl border-2 border-ink/10 bg-white p-4 shadow-[0_4px_0_rgba(27,27,47,0.08)] ${accent ? 'border-l-[10px]' : ''} ${className}`}
    >
      {children}
    </div>
  )
}
