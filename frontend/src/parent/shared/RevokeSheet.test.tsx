import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ChartSticker } from '../../api/types'
import { RevokeSheet, type RevokeSheetProps } from './RevokeSheet'

const sticker = {
  stickerId: 1,
  status: 'UNCLAIMED',
  revocable: true,
  design: { name: 'Star', artworkKey: 'star' },
} as unknown as ChartSticker

function props(over: Partial<RevokeSheetProps> = {}): RevokeSheetProps {
  return {
    ownerKind: 'routine',
    ownerName: 'Morning Routine',
    taskLabel: 'Brush teeth',
    childName: 'Jane Doe',
    date: '2026-03-10',
    sticker,
    lastInRequest: false,
    note: '',
    onNote: () => {},
    busy: false,
    errorKind: null,
    onConfirm: () => {},
    onClose: () => {},
    ...over,
  }
}

describe('RevokeSheet', () => {
  it('keeps the routine wording and shows no chore extras', () => {
    render(<RevokeSheet {...props()} />)
    expect(screen.getByText(/Unchecking 'Brush teeth' in Morning Routine on/)).toHaveTextContent(
      "Jane Doe's Sticker Book. The routine won't be finished until it's done again.",
    )
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('says chore, with the outcome line and the checkbox', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <RevokeSheet
        {...props({
          ownerKind: 'chore',
          ownerName: 'Tidy room',
          outcome: 'The chore goes back on the chart.',
          removeChore: false,
          onRemoveChoreChange: onChange,
        })}
      />,
    )
    expect(screen.getByText(/The chore won't be finished/)).toBeInTheDocument()
    expect(screen.getByText('The chore goes back on the chart.')).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'Remove this chore too' }))
    expect(onChange).toHaveBeenCalledWith(true)
  })
})
