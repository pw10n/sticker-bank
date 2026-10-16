export function Badge({ count }: { count: number }) {
  if (!(count > 0)) return null
  const text = count > 9 ? '9+' : String(count)
  return (
    <span
      aria-label={`${count} pending`}
      className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-strawberry px-1.5 text-sm font-bold leading-none text-ink ring-2 ring-paper"
    >
      {text}
    </span>
  )
}
