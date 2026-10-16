import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import type { ReactNode } from 'react'
import { SoundProvider } from '../sound/SoundProvider'
import { DayRolloverProvider } from './dayRollover'
import { DeviceSettingsProvider } from './deviceSettings'
import { ModeProvider } from './mode'
import { OfflineBanner, OnlineStatusProvider } from './online'
import { PERSIST_MAX_AGE, persister, shouldDehydrateQuery } from './persister'
import { queryClient } from './queryClient'
import { UpdatePromptProvider, UpdateToast } from './updatePrompt'

const buster: string = import.meta.env.VITE_APP_VERSION ?? 'dev'

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: PERSIST_MAX_AGE,
        buster,
        dehydrateOptions: { shouldDehydrateQuery },
      }}
    >
      <DeviceSettingsProvider>
        <ModeProvider>
          <OnlineStatusProvider>
            <SoundProvider>
              <UpdatePromptProvider>
                <DayRolloverProvider>
                  <OfflineBanner />
                  <UpdateToast />
                  {children}
                </DayRolloverProvider>
              </UpdatePromptProvider>
            </SoundProvider>
          </OnlineStatusProvider>
        </ModeProvider>
      </DeviceSettingsProvider>
    </PersistQueryClientProvider>
  )
}
