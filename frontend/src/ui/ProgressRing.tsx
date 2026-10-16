export function ProgressRing({ done, total, size = 96, color }: { done: number; total: number; size?: number; color?: string }) {
  const stroke = Math.max(8, Math.round(size / 8))
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const frac = total > 0 ? Math.min(1, Math.max(0, done / total)) : 0
  return (
    <div
      role="img"
      aria-label={`${done} of ${total} done`}
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(27,27,47,0.12)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color ?? 'var(--child-color, #FFB703)'}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
          style={{ transition: 'stroke-dashoffset 500ms ease-out' }}
        />
      </svg>
      <span aria-hidden="true" className="absolute text-center text-base font-bold leading-tight text-ink">
        {done} of {total}
      </span>
    </div>
  )
}
