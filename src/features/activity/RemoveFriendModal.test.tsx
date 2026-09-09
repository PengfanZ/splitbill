import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { RemoveFriendModal } from './RemoveFriendModal'
import type { Expense } from '../../domain/models'

const props = {
  member: { id: 'sam', name: 'Sam', initials: 'S', color: '#abc' },
  group: { id: 'trip', name: 'Trip', emoji: '☀', memberIds: ['me', 'sam'] },
  expenses: [] as Expense[], live: false, busy: false, readOnly: false, error: null,
  onClose: vi.fn(), onRemove: vi.fn(),
}

describe('RemoveFriendModal', () => {
  it('shows shares, incoming payments, legacy dates and all balance directions', () => {
    const record: Expense = { id: '1', groupId: 'trip', title: 'Dinner', amount: 20, payerId: 'me', shares: { sam: 20 }, splitMethod: 'exact', createdAt: 'Today' }
    const { rerender } = render(<RemoveFriendModal {...props} expenses={[record]} />)
    expect(screen.getByText('Today')).toBeVisible()
    expect(screen.getByText('Sam still owes $20.00')).toBeVisible()
    rerender(<RemoveFriendModal {...props} expenses={[{ ...record, kind: 'settlement', updatedAt: '2026-09-09T12:00:00Z' }]} />)
    expect(screen.getByText('Payment received: $20.00')).toBeVisible()
    rerender(<RemoveFriendModal {...props} expenses={[record, { ...record, id: 'payment', kind: 'settlement', payerId: 'sam', shares: { me: 20 } }]} />)
    expect(screen.getByText('Sam is settled up. History will still be kept.')).toBeVisible()
  })
  it('explains scope and supports cancellation and confirmation', async () => {
    const user = userEvent.setup()
    render(<RemoveFriendModal {...props} />)
    expect(screen.getByText(/Only this activity changes/)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(props.onClose).toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Remove friend' }))
    expect(props.onRemove).toHaveBeenCalled()
  })

  it('shows live access caveat, errors, offline, and pending states', () => {
    const { rerender } = render(<RemoveFriendModal {...props} live error="Try again" />)
    expect(screen.getByText(/does not revoke access/)).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent('Try again')
    rerender(<RemoveFriendModal {...props} live readOnly />)
    expect(screen.getByRole('alert')).toHaveTextContent('Connect and refresh')
    expect(screen.getByRole('button', { name: 'Remove friend' })).toBeDisabled()
    rerender(<RemoveFriendModal {...props} busy />)
    expect(screen.getByRole('button', { name: 'Loading…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
  })

  it('lists every reference and still allows removal without rewriting history', () => {
    const record: Expense = { id: '1', groupId: 'trip', title: 'Dinner', amount: 20, payerId: 'sam', shares: { me: 20 }, splitMethod: 'exact', createdAt: '2026-09-09T12:00:00Z' }
    const { rerender } = render(<RemoveFriendModal {...props} expenses={[record]} />)
    expect(screen.getByRole('heading', { name: 'Remove Sam from future expenses?' })).toBeVisible()
    expect(screen.getByText('Dinner')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Remove friend' })).toBeEnabled()
    rerender(<RemoveFriendModal {...props} expenses={[record, { ...record, id: '2', kind: 'settlement' }, { ...record, id: '3' }, { ...record, id: '4' }]} />)
    expect(screen.getByText('Settlement payment')).toBeVisible()
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
    expect(screen.getByRole('list')).toHaveAccessibleName('Related records (4)')
  })
})
