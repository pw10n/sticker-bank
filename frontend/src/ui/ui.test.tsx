import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Badge,
  BigTile,
  ColorSwatchPicker,
  ConfirmDialog,
  HoldButton,
  ProgressRing,
  Sheet,
  WeekdayPicker,
  celebrateRoutine,
} from './index'
import type { Weekday } from '../api/types'

vi.mock('canvas-confetti', () => ({ default: vi.fn() }))

describe('BigTile', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('reflects aria-pressed and calls onPress', () => {
    const onPress = vi.fn()
    const { rerender } = render(<BigTile icon="🪥" label="Brush" onPress={onPress} />)
    const btn = screen.getByRole('button', { name: /brush/i })
    expect(btn).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(btn)
    expect(onPress).toHaveBeenCalledTimes(1)
    rerender(<BigTile icon="🪥" label="Brush" pressed onPress={onPress} />)
    expect(btn).toHaveAttribute('aria-pressed', 'true')
  })

  it('guards double taps within 600 ms', () => {
    const onPress = vi.fn()
    render(<BigTile icon="🪥" label="Brush" onPress={onPress} />)
    const btn = screen.getByRole('button')
    fireEvent.click(btn)
    vi.advanceTimersByTime(300)
    fireEvent.click(btn)
    expect(onPress).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(400)
    fireEvent.click(btn)
    expect(onPress).toHaveBeenCalledTimes(2)
  })

  it('ignores presses while busy', () => {
    const onPress = vi.fn()
    render(<BigTile icon="🪥" label="Brush" busy onPress={onPress} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onPress).not.toHaveBeenCalled()
  })
})

describe('HoldButton', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('completes only after holdMs', () => {
    const done = vi.fn()
    render(<HoldButton label="Parent Mode" onHoldComplete={done}>P</HoldButton>)
    const btn = screen.getByRole('button', { name: 'Parent Mode' })
    fireEvent.pointerDown(btn)
    act(() => void vi.advanceTimersByTime(999))
    expect(done).not.toHaveBeenCalled()
    act(() => void vi.advanceTimersByTime(2))
    expect(done).toHaveBeenCalledTimes(1)
  })

  it('cancels on early release', () => {
    const done = vi.fn()
    render(<HoldButton label="Parent Mode" onHoldComplete={done}>P</HoldButton>)
    const btn = screen.getByRole('button')
    fireEvent.pointerDown(btn)
    act(() => void vi.advanceTimersByTime(500))
    fireEvent.pointerUp(btn)
    act(() => void vi.advanceTimersByTime(1000))
    expect(done).not.toHaveBeenCalled()
  })

  it('supports keyboard hold and shows badge', () => {
    const done = vi.fn()
    render(<HoldButton label="Parent Mode" badge={3} onHoldComplete={done}>P</HoldButton>)
    const btn = screen.getByRole('button')
    expect(screen.getByText('3')).toBeInTheDocument()
    fireEvent.keyDown(btn, { key: 'Enter' })
    act(() => void vi.advanceTimersByTime(1000))
    expect(done).toHaveBeenCalledTimes(1)
    fireEvent.keyUp(btn, { key: 'Enter' })
    fireEvent.keyDown(btn, { key: ' ' })
    act(() => void vi.advanceTimersByTime(400))
    fireEvent.keyUp(btn, { key: ' ' })
    act(() => void vi.advanceTimersByTime(1000))
    expect(done).toHaveBeenCalledTimes(1)
  })
})

function SheetHarness({ onClose = () => {} }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      <Sheet
        open={open}
        title="Edit"
        onClose={() => {
          onClose()
          setOpen(false)
        }}
        footer={<button>Save</button>}
      >
        <input aria-label="Name" />
      </Sheet>
    </>
  )
}

describe('Sheet', () => {
  it('renders nothing when closed', () => {
    render(<Sheet open={false} onClose={() => {}} title="X">c</Sheet>)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('traps focus, closes on Escape, restores focus', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<SheetHarness onClose={onClose} />)
    const opener = screen.getByRole('button', { name: 'Open' })
    await user.click(opener)
    const dialog = screen.getByRole('dialog', { name: 'Edit' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByLabelText('Name')).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus()
    await user.tab()
    expect(screen.getByLabelText('Name')).toHaveFocus()
    await user.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(opener).toHaveFocus()
  })
})

describe('ConfirmDialog', () => {
  it('fires callbacks with default labels', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<ConfirmDialog open title="Remove?" message="Sure?" onConfirm={onConfirm} onCancel={onCancel} />)
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onConfirm).toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
  })
})

describe('WeekdayPicker', () => {
  it('toggles in MON..SUN order', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<WeekdayPicker value={['WED']} onChange={onChange} />)
    expect(screen.getByRole('button', { name: 'Wednesday' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Monday' }))
    expect(onChange).toHaveBeenLastCalledWith(['MON', 'WED'])
    await user.click(screen.getByRole('button', { name: 'Wednesday' }))
    expect(onChange).toHaveBeenLastCalledWith([])
  })

  it('quick buttons', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn<(d: Weekday[]) => void>()
    render(<WeekdayPicker value={[]} onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: 'Every day' }))
    expect(onChange).toHaveBeenLastCalledWith(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'])
    await user.click(screen.getByRole('button', { name: 'Weekdays' }))
    expect(onChange).toHaveBeenLastCalledWith(['MON', 'TUE', 'WED', 'THU', 'FRI'])
    await user.click(screen.getByRole('button', { name: 'Weekends' }))
    expect(onChange).toHaveBeenLastCalledWith(['SAT', 'SUN'])
  })
})

describe('ColorSwatchPicker', () => {
  it('selects colors and none', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ColorSwatchPicker label="Color" value="#FB8500" onChange={onChange} allowNone />)
    expect(screen.getByRole('button', { name: 'tangerine' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'mint' }))
    expect(onChange).toHaveBeenLastCalledWith('#56CFA1')
    await user.click(screen.getByRole('button', { name: 'No color' }))
    expect(onChange).toHaveBeenLastCalledWith(null)
  })
})

describe('ProgressRing and Badge', () => {
  it('labels progress', () => {
    render(<ProgressRing done={2} total={4} />)
    expect(screen.getByRole('img', { name: '2 of 4 done' })).toBeInTheDocument()
  })

  it('badge 0 / 5 / 12', () => {
    const { container, rerender } = render(<Badge count={0} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<Badge count={5} />)
    expect(screen.getByText('5')).toBeInTheDocument()
    rerender(<Badge count={12} />)
    expect(screen.getByText('9+')).toBeInTheDocument()
  })
})

describe('celebrateRoutine', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('resolves under reduced motion', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: true,
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    const p = celebrateRoutine()
    await vi.advanceTimersByTimeAsync(2000)
    await expect(p).resolves.toBeUndefined()
  })
})
