import { isRouteErrorResponse, Link, useRouteError } from 'react-router'

function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return /dynamically imported module|Importing a module script failed|Loading chunk|Failed to fetch/i.test(
    message,
  )
}

export default function RouteError() {
  const error = useRouteError()
  const notFound = isRouteErrorResponse(error) && error.status === 404
  const chunk = !notFound && isChunkLoadError(error)

  const emoji = notFound ? '🔍' : chunk ? '🎁' : '🙈'
  const text = notFound
    ? "That page isn't here."
    : chunk
      ? 'A new version may be ready — tap to reload.'
      : 'Oops! Something went wrong.'

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-paper p-6 text-center text-ink">
      <div aria-hidden="true" className="text-8xl">
        {emoji}
      </div>
      <p role="alert" className="text-2xl font-bold">
        {text}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-4">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="min-h-16 rounded-full bg-ink px-8 py-3 text-xl font-bold text-paper"
        >
          Try again
        </button>
        <Link to="/" className="min-h-16 rounded-full border-4 border-ink px-8 py-3 text-xl font-bold text-ink">
          Go home
        </Link>
      </div>
    </main>
  )
}
