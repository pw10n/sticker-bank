import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HoldButton } from './HoldButton'

describe('HoldButton', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('keeps its name and exposes the badge count as a description', () => {
    render(<HoldButton label="Parent Mode" badge={3} onHoldComplete={() => {}}>P</HoldButton>)
    const btn = screen.getByRole('button', { name: 'Parent Mode' })
    expect(btn).toHaveAccessibleDescription(/3 waiting/)
    expect(btn).toHaveAccessibleDescription(/Press and hold to open/)
  })

  it('has no count text when badge is 0', () => {
    render(<HoldButton label="Parent Mode" badge={0} onHoldComplete={() => {}}>P</HoldButton>)
    const btn = screen.getByRole('button', { name: 'Parent Mode' })
    expect(btn).not.toHaveAccessibleDescription(/waiting/)
    expect(btn).toHaveAccessibleDescription('Press and hold to open')
  })

  it('fires onHoldComplete after a 1s hold', () => {
    const onHoldComplete = vi.fn()
    render(<HoldButton label="Parent Mode" onHoldComplete={onHoldComplete}>P</HoldButton>)
    const btn = screen.getByRole('button', { name: 'Parent Mode' })
    fireEvent.pointerDown(btn)
    act(() => {
      vi.advanceTimersByTime(999)
    })
    expect(onHoldComplete).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(onHoldComplete).toHaveBeenCalledTimes(1)
  })
})
