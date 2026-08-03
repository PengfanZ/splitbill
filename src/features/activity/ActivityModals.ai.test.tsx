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

function renderModal(
  client: Pick<AiExpenseClient, 'parseBatch'>,
  onSave = vi.fn(),
  expense?: Expense,
  onSaveMany = vi.fn(),
) {
  return {
    onSave,
    onSaveMany,
    ...render(
      <LocalizationProvider>
        <ExpenseModal group={group} members={members} expense={expense} aiExpenseClient={client} onClose={vi.fn()} onSave={onSave} onSaveMany={onSaveMany} />
      </LocalizationProvider>,
    ),
  }
}

describe('AI-assisted expense modal', () => {
  it('prefills an equal draft and still requires the normal save action', async () => {
    const user = userEvent.setup()
    const parseBatch = vi.fn().mockResolvedValue({
      status: 'ready_batch',
      drafts: [{
        status: 'ready',
        title: 'Dinner',
        amountCents: 3001,
        payerId: 'maya',
        splitMethod: 'equal',
        participantIds: ['me', 'maya'],
        exactSharesCents: [],
      }],
    })
    const { onSave } = renderModal({ parseBatch })

    expect(screen.getByRole('tab', { name: 'Enter manually' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('Description')).toBeVisible()
    await user.click(screen.getByRole('tab', { name: 'Describe with AI' }))
    await user.type(screen.getByLabelText('Expense description'), 'Maya paid $30.01 for dinner with me')
    await user.click(screen.getByRole('button', { name: /Create draft/ }))

    expect(await screen.findByText('AI draft ready')).toBeVisible()
    expect(parseBatch).toHaveBeenCalledWith(expect.objectContaining({ viewerMemberId: 'me' }))
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
      parseBatch: vi.fn().mockResolvedValue({
        status: 'ready_batch',
        drafts: [{
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
        }],
      }),
    })
    await user.click(screen.getByRole('tab', { name: 'Describe with AI' }))
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

  it('reviews, edits, removes, and saves a multi-expense batch in one callback', async () => {
    const user = userEvent.setup()
    const parseBatch = vi.fn().mockResolvedValue({
      status: 'ready_batch',
      drafts: [
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
          payerId: 'maya',
          splitMethod: 'equal',
          participantIds: ['me', 'maya', 'jordan'],
          exactSharesCents: [],
        },
      ],
    })
    const { onSave, onSaveMany } = renderModal({ parseBatch })

    await user.click(screen.getByRole('tab', { name: 'Describe with AI' }))
    await user.type(
      screen.getByLabelText('Expense description'),
      'I paid $24 for lunch and Maya paid $46 for groceries. Split both between everyone.',
    )
    await user.click(screen.getByRole('button', { name: /Create draft/ }))

    expect(await screen.findByText('2 expense drafts ready')).toBeVisible()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()
    expect(onSaveMany).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Edit Lunch' }))
    expect(screen.getByText('Editing draft 1 of 2')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Back to drafts' }))
    expect(await screen.findByText('Lunch')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Edit Lunch' }))
    await user.clear(screen.getByLabelText('Description'))
    await user.type(screen.getByLabelText('Description'), 'Team lunch')
    await user.click(screen.getByRole('button', { name: 'Update draft' }))
    expect(await screen.findByText('Team lunch')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Remove Groceries' }))
    expect(screen.queryByText('Groceries')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save expense' }))

    expect(onSave).not.toHaveBeenCalled()
    expect(onSaveMany).toHaveBeenCalledOnce()
    expect(onSaveMany).toHaveBeenCalledWith([
      expect.objectContaining({
        groupId: 'trip',
        title: 'Team lunch',
        amount: 24,
        payerId: 'me',
        splitMethod: 'equal',
        shares: { me: 12, maya: 12 },
        createdAt: expect.any(String),
      }),
    ])
  })

  it('returns to AI text entry if every generated draft is removed', async () => {
    const user = userEvent.setup()
    const draft = {
      status: 'ready' as const,
      title: 'Lunch',
      amountCents: 2400,
      payerId: 'me',
      splitMethod: 'equal' as const,
      participantIds: ['me', 'maya'],
      exactSharesCents: [],
    }
    renderModal({
      parseBatch: vi.fn().mockResolvedValue({ status: 'ready_batch', drafts: [draft, { ...draft, title: 'Dinner' }] }),
    })
    await user.click(screen.getByRole('tab', { name: 'Describe with AI' }))
    await user.type(screen.getByLabelText('Expense description'), 'I paid $24 for lunch and $24 for dinner with Maya')
    await user.click(screen.getByRole('button', { name: /Create draft/ }))
    await user.click(await screen.findByRole('button', { name: 'Remove Lunch' }))
    await user.click(screen.getByRole('button', { name: 'Remove Dinner' }))
    expect(await screen.findByLabelText('Expense description')).toBeVisible()
  })

  it('keeps the batch callback optional for older ExpenseModal consumers', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    const draft = {
      status: 'ready' as const,
      title: 'Lunch',
      amountCents: 2400,
      payerId: 'me',
      splitMethod: 'equal' as const,
      participantIds: ['me', 'maya'],
      exactSharesCents: [],
    }
    render(
      <LocalizationProvider>
        <ExpenseModal
          group={group}
          members={members}
          aiExpenseClient={{
            parseBatch: vi.fn().mockResolvedValue({
              status: 'ready_batch',
              drafts: [draft, { ...draft, title: 'Dinner' }],
            }),
          }}
          onClose={vi.fn()}
          onSave={onSave}
        />
      </LocalizationProvider>,
    )
    await user.click(screen.getByRole('tab', { name: 'Describe with AI' }))
    await user.type(screen.getByLabelText('Expense description'), 'I paid $24 for lunch and $24 for dinner with Maya')
    await user.click(screen.getByRole('button', { name: 'Create draft' }))
    await user.click(await screen.findByRole('button', { name: 'Save 2 expenses' }))
    expect(onSave).toHaveBeenCalledTimes(2)
  })

  it('lets users choose manual entry and keeps editing fully manual', async () => {
    const user = userEvent.setup()
    const client = { parseBatch: vi.fn() }
    const { rerender } = renderModal(client)
    expect(screen.getByLabelText('Description')).toBeVisible()
    expect(screen.getByRole('tab', { name: 'Speak' })).toHaveAttribute('aria-selected', 'false')
    await user.click(screen.getByRole('tab', { name: 'Speak' }))
    expect(screen.getByText('Describe expenses out loud')).toBeVisible()
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

  it('requires and forwards the participant selected on this browser', async () => {
    const user = userEvent.setup()
    const parseBatch = vi.fn().mockResolvedValue({
      status: 'ready_batch',
      drafts: [{
        status: 'ready',
        title: 'Coffee',
        amountCents: 1800,
        payerId: 'maya',
        splitMethod: 'equal',
        participantIds: ['maya', 'jordan'],
        exactSharesCents: [],
      }],
    })
    const onCurrentMemberChange = vi.fn()
    const rendered = render(
      <LocalizationProvider>
        <ExpenseModal
          group={group}
          members={members}
          aiExpenseClient={{ parseBatch }}
          currentMemberId={null}
          onCurrentMemberChange={onCurrentMemberChange}
          onClose={vi.fn()}
          onSave={vi.fn()}
        />
      </LocalizationProvider>,
    )

    await user.click(screen.getByRole('tab', { name: 'Describe with AI' }))
    expect(screen.getByText('Choose who you are so Tally knows who “I” means.')).toBeVisible()
    expect(screen.queryByLabelText('Expense description')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Choose who you are' }))
    await user.click(screen.getByRole('option', { name: 'Maya' }))
    expect(onCurrentMemberChange).toHaveBeenCalledWith('maya')

    rendered.rerender(
      <LocalizationProvider>
        <ExpenseModal
          group={group}
          members={members}
          aiExpenseClient={{ parseBatch }}
          currentMemberId="maya"
          onCurrentMemberChange={onCurrentMemberChange}
          onClose={vi.fn()}
          onSave={vi.fn()}
        />
      </LocalizationProvider>,
    )
    await user.type(screen.getByLabelText('Expense description'), 'I paid $18 for coffee with Jordan')
    await user.click(screen.getByRole('button', { name: /Create draft/ }))
    expect(parseBatch).toHaveBeenCalledWith(expect.objectContaining({
      text: 'I paid $18 for coffee with Jordan',
      viewerMemberId: 'maya',
    }))
  })

  it('uses the selected participant as the default payer for a new manual expense', () => {
    const selected = render(
      <LocalizationProvider>
        <ExpenseModal
          group={group}
          members={members}
          aiExpenseClient={{ parseBatch: vi.fn() }}
          currentMemberId="maya"
          onCurrentMemberChange={vi.fn()}
          onClose={vi.fn()}
          onSave={vi.fn()}
        />
      </LocalizationProvider>,
    )

    expect(screen.getByRole('button', { name: 'Paid by' })).toHaveValue('maya')
    selected.unmount()

    const firstMember = render(
      <LocalizationProvider>
        <ExpenseModal
          group={group}
          members={[maya]}
          currentMemberId={null}
          onClose={vi.fn()}
          onSave={vi.fn()}
        />
      </LocalizationProvider>,
    )
    expect(screen.getByRole('button', { name: 'Paid by' })).toHaveValue('maya')
    firstMember.unmount()

    expect(() => render(
      <LocalizationProvider>
        <ExpenseModal
          group={group}
          members={[]}
          currentMemberId={null}
          onClose={vi.fn()}
          onSave={vi.fn()}
        />
      </LocalizationProvider>,
    )).not.toThrow()
  })
})
