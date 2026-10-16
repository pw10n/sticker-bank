import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { useBootstrap } from '../api/hooks'
import { Spinner } from '../ui'
import { CreatePinFlow } from './CreatePinFlow'

export default function WelcomeScreen() {
  const bootstrap = useBootstrap()
  const navigate = useNavigate()
  const [done, setDone] = useState(false)

  if (bootstrap.isPending) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-paper">
        <Spinner label="Loading" />
      </main>
    )
  }
  if (bootstrap.data && !bootstrap.data.setupRequired && !done) {
    return <Navigate to="/parent" replace />
  }

  return (
    <main data-testid="screen-welcome" className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-paper p-6 text-ink">
      <div className="max-w-md text-center">
        <h1 className="text-4xl font-bold">Welcome to Sticker Bank</h1>
        <p className="mt-3 text-lg">Your little ones finish their daily routines and collect shiny stickers.</p>
        <p className="mt-1 text-lg">Let’s start by picking a secret PIN, so only grown-ups can change things.</p>
      </div>
      <CreatePinFlow
        onDone={() => {
          setDone(true)
          navigate('/parent/children/new')
        }}
        onAlreadySet={() => navigate('/parent', { replace: true })}
      />
    </main>
  )
}
