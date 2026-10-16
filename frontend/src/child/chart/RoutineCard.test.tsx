import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
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

function renderCard(routine: ChartRoutine) {
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
      />
    </MemoryRouter>,
  )
}

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
})
