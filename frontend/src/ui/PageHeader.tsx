import type { ReactNode } from 'react'
import { Link } from 'react-router'

export function PageHeader({ title, back, actions }: { title: string; back?: { to: string; label?: string }; actions?: ReactNode }) {
  return (
    <header className="mb-4 flex flex-wrap items-center gap-3">
      {back && (
        <Link
          to={back.to}
          className="inline-flex min-h-11 items-center gap-1 rounded-2xl bg-white px-4 font-bold text-ink shadow-[0_3px_0_rgba(27,27,47,0.12)] focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          <span aria-hidden="true">←</span>
          {back.label ?? 'Back'}
        </Link>
      )}
      <h1 className="flex-1 text-3xl font-bold">{title}</h1>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  )
}
