import { useBootstrap } from '../api/hooks/bootstrap'
import { buildVersion } from './frontendVersion'

/**
 * The version of this app (stamped into the bundle at build time) next to the version of the server it is talking to
 * (`bootstrap.appVersion`, refetched every 30 s while visible). Side by side, a stale app is obvious: the two differ.
 */
export function VersionFooter({ className = '' }: { className?: string }) {
  const server = useBootstrap().data?.appVersion
  return (
    <p data-testid="version-footer" className={`text-center text-xs text-ink/60 ${className}`}>
      {`App ${buildVersion()}${server ? ` · Server ${server}` : ''}`}
    </p>
  )
}
