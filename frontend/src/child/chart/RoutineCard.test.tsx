import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChartRoutine } from '../../api/types'
import { RoutineCard } from './RoutineCard'

function make(over: Partial<ChartRoutine>): ChartRoutine {
  return {
    routineId: 1,
    name: 'Morning',
    iconKey: 'glowing-star',
    color: null,
    state: 'EARNED',
    doneCount: 1,
    taskCount: 1,
    sticker: null,
    tasks: [{ taskId: 1, label: 'Brush teeth', iconKey: 'glowing-star', done: true }],
    ...over,
  } as ChartRoutine
}

function renderCard(routine: ChartRoutine, extra: Partial<React.ComponentProps<typeof RoutineCard>> = {}) {
  return render(
    <MemoryRouter>
      <RoutineCard
        routine={routine}
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

describe('RoutineCard', () => {
  it('shows the earned sticker art when a design exists', () => {
    renderCard(
      make({
        sticker: {
          stickerId: 5,
          status: 'UNCLAIMED',
          design: { artworkKey: 'whale' },
        } as unknown as ChartRoutine['sticker'],
      }),
    )
    expect(screen.getByText(/Finished!/)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Your sticker' })).toBeInTheDocument()
  })

  it('falls back to a star sticker when sticker is null', () => {
    renderCard(make({ sticker: null }))
    expect(screen.getByText(/Finished!/)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Sticker earned' })).toBeInTheDocument()
  })

  it('shows the pick link when awaiting a pick', () => {
    renderCard(
      make({
        state: 'AWAITING_PICK',
        sticker: { stickerId: 5, status: 'UNCLAIMED', design: null } as unknown as ChartRoutine['sticker'],
      }),
    )
    expect(screen.getByRole('link', { name: /Pick your sticker!/ })).toHaveAttribute('href', '/c/7/pick/5')
  })

  describe("I'm Done! (FR-6.6 to FR-6.8)", () => {
    const ready = () =>
      make({
        state: 'READY_TO_FINISH',
        doneCount: 2,
        taskCount: 2,
        tasks: [
          { taskId: 1, label: 'Brush teeth', iconKey: 'glowing-star', done: true },
          { taskId: 2, label: 'Get dressed', iconKey: 'glowing-star', done: true },
        ],
      })

    it('shows a large button in its own row below the tiles, and no sticker yet', () => {
      renderCard(ready())
      const button = screen.getByRole('button', { name: /I'm Done!/ })
      const lastTile = screen.getByRole('button', { name: 'Get dressed' })
      // the button comes after the task list, so nothing under the finger moves when it appears
      expect(lastTile.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(button.className).toContain('min-h-[88px]')
      expect(screen.queryByText(/Finished!/)).not.toBeInTheDocument()
      expect(screen.queryByRole('link', { name: /Pick your sticker!/ })).not.toBeInTheDocument()
      expect(screen.getByText(/All tasks done/)).toBeInTheDocument()
    })

    it('keeps the tiles tappable so a mistaken tap can be undone', () => {
      renderCard(ready())
      for (const name of ['Brush teeth', 'Get dressed']) {
        expect(screen.getByRole('button', { name })).toBeEnabled()
        expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'true')
      }
    })

    it.each(['IN_PROGRESS', 'NOT_STARTED', 'EARNED', 'AWAITING_PICK', 'MISSED'] as const)('is not shown while %s', (state) => {
      renderCard(make({ state, doneCount: 1, taskCount: 2 }))
      expect(screen.queryByRole('button', { name: /I'm Done!/ })).not.toBeInTheDocument()
    })

    it('is not shown when the device cannot write', () => {
      renderCard(ready(), { canWrite: false })
      expect(screen.queryByRole('button', { name: /I'm Done!/ })).not.toBeInTheDocument()
    })

    it('ignores taps for the first 600 ms so the tap that checked the last task cannot press it', () => {
      vi.useFakeTimers()
      const onFinish = vi.fn()
      renderCard(ready(), { onFinish })
      const button = screen.getByRole('button', { name: /I'm Done!/ })
      fireEvent.click(button)
      act(() => void vi.advanceTimersByTime(599))
      fireEvent.click(button)
      expect(onFinish).not.toHaveBeenCalled()
      act(() => void vi.advanceTimersByTime(1))
      fireEvent.click(button)
      expect(onFinish).toHaveBeenCalledTimes(1)
      expect(onFinish).toHaveBeenCalledWith(expect.objectContaining({ routineId: 1 }))
    })

    it('is disabled while the request is in flight', () => {
      vi.useFakeTimers()
      const onFinish = vi.fn()
      renderCard(ready(), { onFinish, finishing: true })
      act(() => void vi.advanceTimersByTime(1000))
      const button = screen.getByRole('button', { name: /I'm Done!/ })
      expect(button).toBeDisabled()
      fireEvent.click(button)
      expect(onFinish).not.toHaveBeenCalled()
    })
  })
})
