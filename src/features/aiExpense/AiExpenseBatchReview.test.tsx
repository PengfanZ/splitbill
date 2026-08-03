import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Member } from '../../domain/models'
import { LocalizationProvider } from '../../i18n/LocalizationContext'
import type { AiExpenseReadyDraft } from './aiExpenseContract'
import { AiExpenseBatchReview } from './AiExpenseBatchReview'

const members: Member[] = [
  { id: 'me', name: 'Alex', initials: 'A', color: '#aaa' },
  { id: 'maya', name: 'Maya', initials: 'M', color: '#bbb' },
]
const drafts: AiExpenseReadyDraft[] = [
  {
    status: 'ready',
    title: 'Lunch',
    amountCents: 2400,
    payerId: 'me',
    splitMethod: 'equal',
    participantIds: ['me', 'maya'],
    exactSharesCents: [],
  },
  {
    status: 'ready',
    title: 'Groceries',
    amountCents: 4600,
    payerId: 'missing',
    splitMethod: 'equal',
    participantIds: ['maya'],
    exactSharesCents: [],
  },
]

describe('AI expense batch review', () => {
  it('shows every draft and wires edit, remove, cancel, and save actions', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    const onEdit = vi.fn()
    const onRemove = vi.fn()
    const onSave = vi.fn()
    render(
      <LocalizationProvider>
        <AiExpenseBatchReview
          currency="USD"
          drafts={drafts}
          members={members}
          onCancel={onCancel}
          onEdit={onEdit}
          onRemove={onRemove}
          onSave={onSave}
          saving={false}
        />
      </LocalizationProvider>,
    )

    expect(screen.getByText('2 expense drafts ready')).toBeVisible()
    expect(screen.getByText('Lunch')).toBeVisible()
    expect(screen.getByText('$24.00')).toBeVisible()
    expect(screen.getByText('Paid by Alex')).toBeVisible()
    expect(screen.getByText('Paid by Unknown')).toBeVisible()
    expect(screen.getByText('Nothing is saved until you confirm the whole batch.')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Edit Lunch' }))
    await user.click(screen.getByRole('button', { name: 'Remove Groceries' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'Save 2 expenses' }))
    expect(onEdit).toHaveBeenCalledWith(0)
    expect(onRemove).toHaveBeenCalledWith(1)
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onSave).toHaveBeenCalledOnce()
  })

  it('disables saving while a batch is being persisted', () => {
    render(
      <LocalizationProvider>
        <AiExpenseBatchReview
          currency="USD"
          drafts={[]}
          members={members}
          onCancel={vi.fn()}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
          onSave={vi.fn()}
          saving
        />
      </LocalizationProvider>,
    )
    expect(screen.getByRole('button', { name: 'Save 0 expenses' })).toBeDisabled()
  })
})
