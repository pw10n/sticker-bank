import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { useBootstrap, useChangePin, useSettings, useUpdateSettings } from '../../api/hooks'
import type { Settings } from '../../api/types'
import { buildVersion, useDeviceSettings } from '../../app'
import { describePinError, formatCountdown } from '../../child/pinpad/pinErrors'
import { Button, Card, PageHeader, Select, Spinner, TextField, Toggle } from '../../ui'

const PIN_PROPS = {
  inputMode: 'numeric' as const,
  pattern: '\\d{4}',
  maxLength: 4,
  autoComplete: 'off',
  type: 'password',
}

const pinSchema = z
  .object({
    currentPin: z.string().regex(/^\d{4}$/, 'Enter exactly 4 digits'),
    newPin: z.string().regex(/^\d{4}$/, 'Enter exactly 4 digits'),
    confirmPin: z.string(),
  })
  .refine((v) => v.newPin === v.confirmPin, { message: 'The new PINs don’t match', path: ['confirmPin'] })
type PinForm = z.infer<typeof pinSchema>

const IDLE_OPTIONS = [1, 2, 5, 10, 15, 30]

function ChangePinCard() {
  const changePin = useChangePin()
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const form = useForm<PinForm>({
    resolver: zodResolver(pinSchema),
    defaultValues: { currentPin: '', newPin: '', confirmPin: '' },
  })
  const { errors } = form.formState

  const onSubmit = form.handleSubmit((v) => {
    setMessage(null)
    changePin.mutate(
      { currentPin: v.currentPin, newPin: v.newPin },
      {
        onSuccess: () => {
          form.reset()
          setMessage({ ok: true, text: 'Your PIN has been changed.' })
        },
        onError: (e) => {
          const info = describePinError(e)
          form.resetField('currentPin')
          setMessage({
            ok: false,
            text: info.lockedSeconds
              ? `${info.message} Try again in ${formatCountdown(info.lockedSeconds)}.`
              : info.message,
          })
        },
      },
    )
  })

  return (
    <Card>
      <h2 className="mb-3 text-xl font-bold">Change PIN</h2>
      <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-3" noValidate>
        <TextField label="Current PIN" {...PIN_PROPS} error={errors.currentPin?.message} {...form.register('currentPin')} />
        <TextField label="New PIN" {...PIN_PROPS} error={errors.newPin?.message} {...form.register('newPin')} />
        <TextField label="Confirm new PIN" {...PIN_PROPS} error={errors.confirmPin?.message} {...form.register('confirmPin')} />
        <div role="status" className="min-h-6 font-bold">
          {message?.text}
        </div>
        <Button type="submit" loading={changePin.isPending} className="self-start">
          Change PIN
        </Button>
      </form>
    </Card>
  )
}

function timeZoneOptions(current: string): string[] {
  let zones: string[]
  try {
    const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf
    zones = fn ? fn('timeZone') : []
  } catch {
    zones = []
  }
  if (zones.length === 0) {
    zones = ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Paris', 'Asia/Tokyo', 'Australia/Sydney']
  }
  return zones.includes(current) ? zones : [current, ...zones]
}

function PreferencesCard({ settings }: { settings: Settings }) {
  const update = useUpdateSettings()
  const [saved, setSaved] = useState(false)
  const zones = useMemo(() => timeZoneOptions(settings.timeZone), [settings.timeZone])
  const minutes = settings.parentIdleTimeoutSeconds / 60
  const idleOptions = IDLE_OPTIONS.includes(minutes) ? IDLE_OPTIONS : [...IDLE_OPTIONS, minutes].sort((a, b) => a - b)
  const form = useForm<{ timeZone: string; minutes: string }>({
    defaultValues: { timeZone: settings.timeZone, minutes: String(minutes) },
  })

  return (
    <Card>
      <h2 className="mb-3 text-xl font-bold">Time and lock</h2>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) =>
          void form.handleSubmit((v) => {
            setSaved(false)
            update.mutate(
              { timeZone: v.timeZone, parentIdleTimeoutSeconds: Number(v.minutes) * 60 },
              { onSuccess: () => setSaved(true) },
            )
          })(e)
        }
      >
        <Select
          label="Time zone"
          hint="Changing the time zone changes which day is ‘today’ from now on."
          {...form.register('timeZone')}
        >
          {zones.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </Select>
        <Select label="Parent Mode auto-lock after" {...form.register('minutes')}>
          {idleOptions.map((m) => (
            <option key={m} value={m}>
              {m} {m === 1 ? 'minute' : 'minutes'}
            </option>
          ))}
        </Select>
        <div role="status" className="min-h-6 font-bold">
          {saved && 'Settings saved.'}
          {update.isError && 'Could not save. Please try again.'}
        </div>
        <Button type="submit" loading={update.isPending} className="self-start">
          Save settings
        </Button>
      </form>
    </Card>
  )
}

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>
}

function InstallCard() {
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null)
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setPromptEvent(e as InstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent)

  if (!promptEvent && !isIos) return null
  return (
    <Card>
      <h2 className="mb-2 text-xl font-bold">Install the app</h2>
      {promptEvent ? (
        <Button
          onClick={() => {
            void promptEvent.prompt()
            setPromptEvent(null)
          }}
        >
          Install
        </Button>
      ) : (
        <p>Tap Share → Add to Home Screen</p>
      )}
    </Card>
  )
}

export default function SettingsScreen() {
  const settings = useSettings()
  const bootstrap = useBootstrap()
  const { soundsOn, setSoundsOn } = useDeviceSettings()
  const reset = settings.data?.lastPinReset

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Settings" />
      <ChangePinCard />

      {settings.isPending ? (
        <Spinner label="Loading" />
      ) : settings.data ? (
        <>
          <PreferencesCard settings={settings.data} />
          <Card>
            <h2 className="mb-1 text-xl font-bold">Last PIN reset</h2>
            <p>{reset ? `Last reset by ${reset.adminName} on ${new Date(reset.resetAt).toLocaleDateString()}` : 'Never'}</p>
          </Card>
        </>
      ) : (
        <p role="alert">Could not load settings.</p>
      )}

      <Card>
        <h2 className="mb-3 text-xl font-bold">This device</h2>
        <Toggle label="Sounds" checked={soundsOn} onChange={setSoundsOn} />
      </Card>

      <InstallCard />

      <Card>
        <h2 className="mb-1 text-xl font-bold">About</h2>
        <p>App version {buildVersion()}</p>
        <p>Server version {bootstrap.data?.appVersion ?? '…'}</p>
        <p>
          <a href="/licenses/" className="inline-flex min-h-11 items-center font-bold underline underline-offset-4">
            Open-source licenses
          </a>
        </p>
      </Card>
    </div>
  )
}
