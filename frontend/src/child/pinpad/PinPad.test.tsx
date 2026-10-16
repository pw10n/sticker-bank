import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PinPad } from './PinPad'

afterEach(() => vi.useRealTimers())

describe('PinPad', () => {
  it('fills dots, supports backspace and auto-submits on the 4th digit', async () => {
    const onComplete = vi.fn()
    const user = userEvent.setup()
    render(<PinPad title="Enter PIN" onComplete={onComplete} />)
    expect(screen.getByRole('dialog', { name: 'Enter PIN' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '1' }))
    await user.click(screen.getByRole('button', { name: '2' }))
    expect(screen.getByRole('img', { name: '2 of 4 digits entered' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Backspace' }))
    expect(screen.getByRole('img', { name: '1 of 4 digits entered' })).toBeInTheDocument()
    for (const d of ['9', '8', '7']) await user.click(screen.getByRole('button', { name: d }))
    expect(onComplete).toHaveBeenCalledExactlyOnceWith('1987')
    expect(screen.getByRole('img', { name: '0 of 4 digits entered' })).toBeInTheDocument()
  })

  it('accepts physical keyboard digits and Backspace', async () => {
    const onComplete = vi.fn()
    const user = userEvent.setup()
    render(<PinPad title="Enter PIN" onComplete={onComplete} />)
    await user.keyboard('12')
    await user.keyboard('{Backspace}')
    await user.keyboard('345')
    expect(onComplete).toHaveBeenCalledExactlyOnceWith('1345')
  })

  it('shows errors in a live region', () => {
    render(<PinPad title="Enter PIN" onComplete={() => {}} error="That is wrong" />)
    expect(screen.getByText('That is wrong')).toBeInTheDocument()
  })

  it('disables the keypad during a lockout and counts down', () => {
    vi.useFakeTimers()
    const onComplete = vi.fn()
    render(<PinPad title="Enter PIN" onComplete={onComplete} lockedSeconds={45} />)
    expect(screen.getByText('Try again in 0:45')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '5' })).toBeDisabled()
    fireEvent.keyDown(document, { key: '1' })
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(screen.getByText('Try again in 0:44')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(44_000)
    })
    expect(screen.queryByText(/Try again in/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '5' })).toBeEnabled()
  })
})
