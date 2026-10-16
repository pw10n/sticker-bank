import type { ReactNode } from 'react'

export function EmptyState({ icon, title, message, action }: { icon: ReactNode; title: string; message?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-[2rem] border-4 border-dashed border-ink/20 bg-white/60 p-8 text-center">
      <div aria-hidden="true" className="text-7xl">
        {icon}
      </div>
      <h2 className="text-2xl font-bold">{title}</h2>
      {message && <p className="max-w-md text-lg">{message}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
