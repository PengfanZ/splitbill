import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CURRENT_USER } from '../../domain/members'
import type { ActivityGroup, Expense, Member } from '../../domain/models'
import type { AiExpenseClient } from '../aiExpense/aiExpenseApi'
import { LocalizationProvider } from '../../i18n/LocalizationContext'
import { ExpenseModal } from './ActivityModals'

const maya: Member = { id: 'maya', name: 'Maya', initials: 'M', color: '#abc' }
const jordan: Member = { id: 'jordan', name: 'Jordan', initials: 'J', color: '#def' }
const members = [CURRENT_USER, maya, jordan]
const group: ActivityGroup = {
  id: 'trip',
  name: 'Weekend',
  emoji: '✦',
  memberIds: members.map(member => member.id),
  currency: 'USD',
}

function renderModal(client: AiExpenseClient, onSave = vi.fn(), expense?: Expense) {
  return {
    onSave,
    ...render(
      <LocalizationProvider>
        <ExpenseModal group={group} members={members} expense={expense} aiExpenseClient={client} onClose={vi.fn()} onSave={onSave} />
      </LocalizationProvider>,
    ),
  }
}

describe('AI-assisted expense modal', () => {
  it('prefills an equal draft and still requires the normal save action', async () => {
    const user = userEvent.setup()
    const parse = vi.fn().mockResolvedValue({
      status: 'ready',
      title: 'Dinner',
      amountCents: 3001,
      payerId: 'maya',
      splitMethod: 'equal',
      participantIds: ['me', 'maya'],
      exactSharesCents: [],
    })
    const { onSave } = renderModal({ parse })

    expect(screen.getByRole('tab', { name: 'Describe with AI' })).toHaveAttribute('aria-selected', 'true')
    await user.type(screen.getByLabelText('Expense description'), 'Maya paid $30.01 for dinner with me')
    await user.click(screen.getByRole('button', { name: /Create draft/ }))

    expect(await screen.findByText('AI draft ready')).toBeVisible()
    expect(screen.getByRole('tab', { name: 'Enter manually' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('Description')).toHaveValue('Dinner')
    expect(screen.getByLabelText('Amount')).toHaveValue(30.01)
    expect(screen.getByRole('button', { name: 'Paid by' })).toHaveValue('maya')
    expect(screen.getByText('2 of 3 selected')).toBeVisible()
    expect(onSave).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Save expense' }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Dinner',
      amount: 30.01,
      payerId: 'maya',
      splitMethod: 'equal',
      shares: { me: 15.01, maya: 15 },
    }))
  })

  it('prefills exact shares and leaves uninvolved members at zero', async () => {
    const user = userEvent.setup()
    const { onSave } = renderModal({
      parse: vi.fn().mockResolvedValue({
        status: 'ready',
        title: 'Tickets',
        amountCents: 3000,
        payerId: 'me',
        splitMethod: 'exact',
        participantIds: ['me', 'maya'],
        exactSharesCents: [
          { memberId: 'me', amountCents: 1000 },
          { memberId: 'maya', amountCents: 2000 },
        ],
      }),
    })
    await user.type(screen.getByLabelText('Expense description'), 'I paid $30 for tickets; I owe $10 and Maya owes $20')
    await user.click(screen.getByRole('button', { name: /Create draft/ }))

    expect(await screen.findByLabelText('You share')).toHaveValue(10)
    expect(screen.getByLabelText('Maya share')).toHaveValue(20)
    expect(screen.getByLabelText('Jordan share')).toHaveValue(null)
    await user.click(screen.getByRole('button', { name: 'Save expense' }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      splitMethod: 'exact',
      shares: { me: 10, maya: 20, jordan: 0 },
    }))
  })

  it('lets users choose manual entry and keeps editing fully manual', async () => {
    const user = userEvent.setup()
    const client: AiExpenseClient = { parse: vi.fn() }
    const { rerender } = renderModal(client)
    await user.click(screen.getByRole('tab', { name: 'Enter manually' }))
    expect(screen.getByLabelText('Description')).toBeVisible()
    await user.click(screen.getByRole('tab', { name: 'Describe with AI' }))
    expect(screen.getByLabelText('Expense description')).toBeVisible()

    const existing: Expense = {
      id: 'dinner',
      groupId: group.id,
      title: 'Dinner',
      amount: 30,
      payerId: 'me',
      splitMethod: 'equal',
      shares: { me: 10, maya: 10, jordan: 10 },
      createdAt: '2026-07-31T10:00:00.000Z',
    }
    rerender(
      <LocalizationProvider>
        <ExpenseModal group={group} members={members} expense={existing} aiExpenseClient={client} onClose={vi.fn()} onSave={vi.fn()} />
      </LocalizationProvider>,
    )
    expect(screen.queryByRole('tab', { name: 'Describe with AI' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Edit expense' })).toBeVisible()
  })
})
