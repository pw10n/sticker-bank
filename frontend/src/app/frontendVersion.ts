const CORE = /^(\d+)\.(\d+)\.(\d+)/

/** The version stamped into this bundle at build time (`dev` for local builds). */
export const buildVersion = (): string => import.meta.env.VITE_APP_VERSION ?? 'dev'

function parse(version: string | null | undefined): [number, number, number] | null {
  const m = version ? CORE.exec(version.trim()) : null
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/**
 * True when the server requires a newer frontend than [build] (TDD 9.5). Only the numeric x.y.z part counts. A dev build,
 * a missing minimum, or anything unparseable never forces a reload: a wrong guess here would reload a child's tablet.
 */
export function isFrontendOutdated(build: string, min: string | null): boolean {
  const b = parse(build)
  const m = parse(min)
  if (!b || !m) return false
  for (let i = 0; i < 3; i++) {
    if (b[i] !== m[i]) return b[i] < m[i]
  }
  return false
}
