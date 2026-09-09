import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ActivityGroup, Expense } from '../../domain/models'
import { CURRENT_USER } from '../../domain/members'
import { AddFriendModal, ExpenseModal } from './ActivityModals'
import { MembersRail } from './ActivityDashboard'

const maya = { id: 'maya', name: 'Maya', initials: 'M', color: '#abc' }
const sam = { id: 'sam', name: 'Sam', initials: 'S', color: '#def' }
const members = [CURRENT_USER, maya, sam]
const group: ActivityGroup = { id: 'trip', name: 'Trip', emoji: '☀', memberIds: members.map(member => member.id) }
const removed = { ...group, inactiveMemberIds: ['maya', 'sam'] }
const expense: Expense = { id: 'dinner', groupId: 'trip', title: 'Dinner', amount: 20, payerId: 'maya', splitMethod: 'exact', shares: { me: 10, maya: 10 }, createdAt: '2026-09-09T12:00:00Z' }

describe('expense membership rules', () => {
  it('explains restore instead of creating a duplicate and keeps offline removed friends read-only', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<AddFriendModal hasRemovedFriends existingExpenseCount={1} onClose={vi.fn()} onSave={vi.fn()} />)
    expect(screen.getByText(/Adding a name creates a new person/)).toBeVisible()
    unmount()
    render(<MembersRail group={removed} members={members} readOnly />)
    await user.click(screen.getByText('Removed friends (2)'))
    expect(screen.getByText('Maya')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Restore Maya' })).not.toBeInTheDocument()
  })
  it('keeps original inactive people on an old exact bill, without adding other inactive friends', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<ExpenseModal group={removed} members={members} expense={expense} onSave={onSave} onClose={vi.fn()} />)
    expect(screen.getByLabelText('Maya share')).toHaveValue(10)
    expect(screen.queryByLabelText('Sam share')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Paid by' })).toHaveTextContent('Maya · removed')
    expect(screen.getByText(/Removed friends already on this bill are kept/)).toBeVisible()
    await user.clear(screen.getByLabelText('Description'))
    await user.type(screen.getByLabelText('Description'), 'Corrected dinner')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ payerId: 'maya', shares: expense.shares, title: 'Corrected dinner' }))
  })

  it.each(['maya', 'me'])('requires explicit review when an open equal split changes (payer %s)', async currentMemberId => {
    const user = userEvent.setup()
    const props = { members, currentMemberId, onSave: vi.fn(), onClose: vi.fn() }
    const { rerender } = render(<ExpenseModal {...props} group={group} />)
    await user.type(screen.getByLabelText('Description'), 'Coffee')
    await user.type(screen.getByLabelText('Amount'), '12')
    rerender(<ExpenseModal {...props} group={removed} />)
    expect(screen.getByRole('button', { name: 'Save expense' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('Your expense has not been saved')
    await user.click(screen.getByRole('button', { name: 'Use current participants' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save expense' }))
    expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({ payerId: 'me', shares: { me: 12 } }))
  })

  it('cannot save when no eligible people remain, including after explicit review', async () => {
    const user = userEvent.setup()
    render(<ExpenseModal group={group} members={[]} onSave={vi.fn()} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Use current participants' }))
    expect(screen.getByRole('button', { name: 'Save expense' })).toBeDisabled()
  })

  it('sends active people only to AI and requires a valid identity for both text and voice', async () => {
    const user = userEvent.setup()
    const parseBatch = vi.fn().mockResolvedValue({ status: 'needs_clarification', question: 'What was it for?' })
    const props = { group: removed, members, onSave: vi.fn(), onClose: vi.fn(), aiExpenseClient: { parseBatch }, onCurrentMemberChange: vi.fn() }
    const { rerender } = render(<ExpenseModal {...props} currentMemberId="maya" />)
    for (const tab of ['Describe with AI', 'Speak']) {
      await user.click(screen.getByRole('tab', { name: tab }))
      expect(screen.getByText('Choose who you are so Tally knows who “I” means.')).toBeVisible()
    }
    expect(parseBatch).not.toHaveBeenCalled()
    rerender(<ExpenseModal {...props} currentMemberId="me" />)
    await user.click(screen.getByRole('tab', { name: 'Describe with AI' }))
    await user.type(screen.getByLabelText('Expense description'), 'I paid 12 dollars for coffee, split equally.')
    await user.click(screen.getByRole('button', { name: /Create draft/ }))
    expect(parseBatch).toHaveBeenCalledWith(expect.objectContaining({ members: [{ id: 'me', name: CURRENT_USER.name }], viewerMemberId: 'me' }))
  })

  it('blocks outdated AI batches, then lets users repair the affected draft', async () => {
    const user = userEvent.setup()
    const draft = { status: 'ready' as const, title: 'Lunch', amountCents: 2000, payerId: 'maya', splitMethod: 'equal' as const, participantIds: ['me', 'maya'], exactSharesCents: [] }
    const parseBatch = vi.fn().mockResolvedValue({ status: 'ready_batch', drafts: [draft, { ...draft, title: 'Coffee', payerId: 'me', participantIds: ['me'] }] })
    const props = { members, currentMemberId: 'me', aiExpenseClient: { parseBatch }, onSave: vi.fn(), onSaveMany: vi.fn(), onClose: vi.fn() }
    const { rerender } = render(<ExpenseModal {...props} group={group} />)
    await user.click(screen.getByRole('tab', { name: 'Describe with AI' }))
    await user.type(screen.getByLabelText('Expense description'), 'Maya paid 20 for lunch split equally, I paid 20 for coffee just for me.')
    await user.click(screen.getByRole('button', { name: /Create draft/ }))
    await screen.findByText('2 expense drafts ready')
    rerender(<ExpenseModal {...props} group={removed} />)
    expect(screen.getByRole('button', { name: 'Save 2 expenses' })).toBeDisabled()
    expect(screen.getByText('Edit or remove the affected drafts before saving.')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Edit Lunch' }))
    await user.click(screen.getByRole('button', { name: 'Use current participants' }))
    await user.click(screen.getByRole('button', { name: 'Update draft' }))
    await user.click(screen.getByRole('button', { name: 'Save 2 expenses' }))
    expect(props.onSaveMany).toHaveBeenCalledWith([expect.objectContaining({ shares: { me: 20 }, payerId: 'me' }), expect.objectContaining({ shares: { me: 20 } })])
  })
})
