import type { CSSProperties, ReactNode } from 'react'

export const DEFAULT_CHILD_COLOR = '#FFB703'

export function ThemeScope({ color, children, className = '' }: { color: string | null | undefined; children: ReactNode; className?: string }) {
  const hex = color || DEFAULT_CHILD_COLOR
  const style = {
    '--child-color': hex,
    '--child-color-soft': `color-mix(in srgb, ${hex} 25%, white)`,
    '--child-ink': '#1B1B2F',
  } as CSSProperties
  return (
    <div style={style} className={className}>
      {children}
    </div>
  )
}
