export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2">
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-6 w-6 animate-spin motion-reduce:animate-none"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      >
        <circle cx="12" cy="12" r="9" opacity="0.25" />
        <path d="M21 12a9 9 0 0 0-9-9" />
      </svg>
      <span className="sr-only">{label}</span>
    </span>
  )
}
