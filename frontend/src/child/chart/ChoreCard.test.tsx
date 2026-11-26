import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChartChore } from '../../api/types'
import { dueHint } from './dueHint'
import { RoutineCard } from './RoutineCard'

function chore(over: Partial<ChartChore> = {}): ChartChore {
  return {
    choreId: 4,
    name: 'Feed the dog',
    iconKey: 'dog',
    dueDate: null,
    state: 'IN_PROGRESS',
    doneCount: 1,
    taskCount: 2,
    sticker: null,
    tasks: [
      { taskId: 10, label: 'Fill the bowl', iconKey: 'glowing-star', done: true },
      { taskId: 11, label: 'Fresh water', iconKey: 'glowing-star', done: false },
    ],
    ...over,
  }
}

function renderChore(c: ChartChore, extra: Partial<React.ComponentProps<typeof RoutineCard>> = {}) {
  return render(
    <MemoryRouter>
      <RoutineCard
        routine={c}
        kind="chore"
        today="2026-11-26"
        childId={7}
        childColor="#ff8800"
        highlighted={false}
        canWrite
        pendingTaskIds={new Set()}
        onToggle={() => {}}
        {...extra}
      />
    </MemoryRouter>,
  )
}

afterEach(() => {
  vi.useRealTimers()
})

describe('dueHint', () => {
  it('says Today only when due today', () => {
    expect(dueHint('2026-11-26', '2026-11-26')).toBe('Today only')
  })
  it('says By <weekday> within six days', () => {
    expect(dueHint('2026-11-28', '2026-11-26')).toBe('By Saturday')
    expect(dueHint('2026-12-02', '2026-11-26')).toBe('By Wednesday')
  })
  it('says By <date> from seven days on', () => {
    const hint = dueHint('2026-12-03', '2026-11-26')
    expect(hint).toMatch(/^By /)
    expect(hint).toContain('3')
    expect(hint).not.toContain('Thursday')
  })
  it('has no hint without a due date', () => {
    expect(dueHint(null, '2026-11-26')).toBeNull()
  })
})

describe('RoutineCard drawing a chore', () => {
  it('shows the Chore tag, progress and tiles in progress', () => {
    renderChore(chore())
    const card = screen.getByRole('region', { name: 'Feed the dog' })
    expect(card).toHaveAttribute('data-kind', 'chore')
    expect(within(card).getByTestId('chore-tag')).toHaveTextContent('Chore')
    expect(within(card).getByText('1 of 2 done')).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Fill the bowl' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(card).queryByRole('button', { name: /I'm Done!/ })).not.toBeInTheDocument()
    expect(within(card).queryByTestId('chore-due')).not.toBeInTheDocument()
  })

  it('shows the due hint with the alarm clock', () => {
    renderChore(chore({ dueDate: '2026-11-26' }))
    const due = screen.getByTestId('chore-due')
    expect(due).toHaveTextContent('Today only')
    expect(due.querySelector('img, svg, picture')).not.toBeNull()
  })

  it('shows By <weekday> for a later due date', () => {
    renderChore(chore({ dueDate: '2026-11-28' }))
    expect(screen.getByTestId('chore-due')).toHaveTextContent('By Saturday')
  })

  it("shows I'm Done! only when ready, and ignores taps for its first 600 ms", () => {
    vi.useFakeTimers()
    const onFinish = vi.fn()
    renderChore(chore({ state: 'READY_TO_FINISH', doneCount: 2 }), { onFinish })
    const done = screen.getByRole('button', { name: /I'm Done!/ })
    expect(screen.getByText(/All tasks done/)).toBeInTheDocument()
    fireEvent.click(done)
    expect(onFinish).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(650)
    })
    fireEvent.click(done)
    expect(onFinish).toHaveBeenCalledTimes(1)
  })

  it('does not show I\'m Done! for a not-ready chore even when its tasks look done', () => {
    renderChore(chore({ state: 'IN_PROGRESS', doneCount: 2 }))
    expect(screen.queryByRole('button', { name: /I'm Done!/ })).not.toBeInTheDocument()
  })

  it('shows Pick your sticker! while awaiting the pick', () => {
    renderChore(
      chore({
        state: 'AWAITING_PICK',
        doneCount: 2,
        sticker: { stickerId: 9, status: 'UNCLAIMED', design: null } as ChartChore['sticker'],
      }),
    )
    expect(screen.getByRole('link', { name: /Pick your sticker!/ })).toHaveAttribute('href', '/c/7/pick/9')
  })

  it('collapses to the Finished! row with the sticker when earned', () => {
    renderChore(
      chore({
        state: 'EARNED',
        doneCount: 2,
        sticker: { stickerId: 9, status: 'AVAILABLE', design: { artworkKey: 'whale' } } as ChartChore['sticker'],
      }),
    )
    expect(screen.getByText(/Finished!/)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Your sticker' })).toBeInTheDocument()
    expect(screen.getByTestId('chore-tag')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Fill the bowl' })).not.toBeInTheDocument()
  })

  it('passes the tap through with the chore', () => {
    const onToggle = vi.fn()
    renderChore(chore(), { onToggle })
    fireEvent.click(screen.getByRole('button', { name: 'Fresh water' }))
    expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ choreId: 4 }), 11, true, expect.anything())
  })
})
