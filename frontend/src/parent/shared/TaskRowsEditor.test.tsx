import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FormProvider, useForm } from 'react-hook-form'
import { describe, expect, it } from 'vitest'
import { TaskRowsEditor, type TaskRowsFormShape } from './TaskRowsEditor'

function Harness({ max, count }: { max: number; count: number }) {
  const form = useForm<TaskRowsFormShape>({
    defaultValues: { tasks: Array.from({ length: count }, (_, i) => ({ label: `Job ${i + 1}`, iconKey: 'sun' })) },
  })
  return (
    <FormProvider {...form}>
      <TaskRowsEditor max={max} />
    </FormProvider>
  )
}

describe('TaskRowsEditor', () => {
  it('adds and removes rows', async () => {
    const user = userEvent.setup()
    render(<Harness max={5} count={1} />)
    expect(screen.getByLabelText('Task 1')).toHaveValue('Job 1')
    await user.click(screen.getByRole('button', { name: 'Add task' }))
    expect(screen.getByLabelText('Task 2')).toHaveValue('')
    await user.click(screen.getByRole('button', { name: 'Remove task 1' }))
    expect(screen.queryByLabelText('Task 2')).toBeNull()
    expect(screen.getByLabelText('Task 1')).toHaveValue('')
  })

  it('stops at max and shows the hint', () => {
    render(<Harness max={2} count={2} />)
    expect(screen.getByRole('button', { name: 'Add task' })).toBeDisabled()
    expect(screen.getByText('You can add up to 2 tasks.')).toBeInTheDocument()
  })
})
