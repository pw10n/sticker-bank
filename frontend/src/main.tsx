import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import './index.css'
import { AppProviders } from './app/AppProviders'
import { router } from './app/routes'

async function bootstrap() {
  if (import.meta.env.MODE === 'mock') {
    const { startMockWorker } = await import('./mocks/browser')
    await startMockWorker()
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>
    </StrictMode>,
  )
}

void bootstrap()
