import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ActivityGroup, Expense } from '../../domain/models'
import { CURRENT_USER } from '../../domain/members'
import { fromPaymentTimeInput, toPaymentTimeInput } from '../../domain/paymentTimeInput'
import { ExpenseModal, SettleUpModal } from './ActivityModals'

const maya = { id: 'maya', name: 'Maya', initials: 'M', color: '#abc' }
const members = [CURRENT_USER, maya]
const group: ActivityGroup = { id: 'trip', name: 'Trip', emoji: '☀', memberIds: ['me', 'maya'] }
const legacy: Expense = { id: 'dinner', groupId: 'trip', title: 'Dinner', amount: 20, payerId: 'me', splitMethod: 'equal', shares: { me: 10, maya: 10 }, createdAt: '2026-11-15T20:00:00.000Z' }
const backdated: Expense = { ...legacy, paidAt: '2026-11-13T19:30:45.123Z' }
const settlement = { from: maya, to: CURRENT_USER, amount: 10 }
const paidOn = () => screen.getByLabelText('Paid on')
const savedExpense = (onSave: ReturnType<typeof vi.fn>) => onSave.mock.calls[0][0] as Expense

async function fillNewExpense(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Description'), 'Coffee')
  await user.type(screen.getByLabelText('Amount'), '12')
}

describe('expense payment time', () => {
  it('prefills now and stores no payment time when the field is left alone', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    const before = Date.now()
    render(<ExpenseModal group={group} members={members} onSave={onSave} onClose={vi.fn()} />)

    const prefilled = Date.parse(fromPaymentTimeInput((paidOn() as HTMLInputElement).value)!)
    expect(prefilled).toBeGreaterThan(before - 60_000)
    expect(prefilled).toBeLessThanOrEqual(Date.now())
    await fillNewExpense(user)
    await user.click(screen.getByRole('button', { name: 'Save expense' }))

    expect('paidAt' in savedExpense(onSave)).toBe(false)
  })

  it('stores the chosen payment time on a new expense without moving when it was recorded', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    const before = Date.now()
    render(<ExpenseModal group={group} members={members} onSave={onSave} onClose={vi.fn()} />)

    await fillNewExpense(user)
    fireEvent.change(paidOn(), { target: { value: '2026-11-13T19:30' } })
    await user.click(screen.getByRole('button', { name: 'Save expense' }))

    expect(savedExpense(onSave).paidAt).toBe(fromPaymentTimeInput('2026-11-13T19:30'))
    expect(Date.parse(savedExpense(onSave).createdAt)).toBeGreaterThanOrEqual(before)
  })

  it('leaves an older expense without a payment time when only its title changes', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<ExpenseModal group={group} members={members} expense={legacy} onSave={onSave} onClose={vi.fn()} />)

    expect(paidOn()).toHaveValue(toPaymentTimeInput(legacy.createdAt))
    await user.type(screen.getByLabelText('Description'), ' out')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(savedExpense(onSave)).toMatchObject({ title: 'Dinner out', createdAt: legacy.createdAt })
    expect('paidAt' in savedExpense(onSave)).toBe(false)
  })

  it('keeps an existing payment time to the millisecond when it is not edited', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<ExpenseModal group={group} members={members} expense={backdated} onSave={onSave} onClose={vi.fn()} />)

    expect(paidOn()).toHaveValue(toPaymentTimeInput(backdated.paidAt!))
    await user.type(screen.getByLabelText('Description'), ' out')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(savedExpense(onSave).paidAt).toBe('2026-11-13T19:30:45.123Z')
  })

  it('changes the payment time on edit and marks the expense edited', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<ExpenseModal group={group} members={members} expense={backdated} onSave={onSave} onClose={vi.fn()} />)

    fireEvent.change(paidOn(), { target: { value: '2026-11-12T08:15' } })
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(savedExpense(onSave)).toMatchObject({ paidAt: fromPaymentTimeInput('2026-11-12T08:15'), createdAt: legacy.createdAt })
    expect(savedExpense(onSave).updatedAt).toBeTruthy()
  })

  it('does not save an expense without a payment time', () => {
    const onSave = vi.fn()
    render(<ExpenseModal group={group} members={members} expense={legacy} onSave={onSave} onClose={vi.fn()} />)

    fireEvent.change(paidOn(), { target: { value: '' } })
    expect(screen.getByRole('alert')).toHaveTextContent('Enter when this was paid.')
    fireEvent.submit(paidOn().closest('form')!)

    expect(onSave).not.toHaveBeenCalled()
  })

  it('still saves an old expense whose recorded time is unreadable', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<ExpenseModal group={group} members={members} expense={{ ...legacy, createdAt: 'Just now' }} onSave={onSave} onClose={vi.fn()} />)

    expect(paidOn()).toHaveValue('')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Description'), ' out')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(savedExpense(onSave)).toMatchObject({ title: 'Dinner out', createdAt: 'Just now' })
    expect('paidAt' in savedExpense(onSave)).toBe(false)
  })

  it('records a payment with a payment time only when one is chosen', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    const { unmount } = render(<SettleUpModal group={group} settlement={settlement} onSave={onSave} onClose={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Record payment' }))
    expect('paidAt' in savedExpense(onSave)).toBe(false)
    unmount()

    onSave.mockClear()
    render(<SettleUpModal group={group} settlement={settlement} onSave={onSave} onClose={vi.fn()} />)
    fireEvent.change(paidOn(), { target: { value: '2026-11-13T19:30' } })
    await user.click(screen.getByRole('button', { name: 'Record payment' }))

    expect(savedExpense(onSave).paidAt).toBe(fromPaymentTimeInput('2026-11-13T19:30'))
  })

  it('does not record a payment without a payment time', () => {
    const onSave = vi.fn()
    render(<SettleUpModal group={group} settlement={settlement} onSave={onSave} onClose={vi.fn()} />)

    fireEvent.change(paidOn(), { target: { value: '' } })
    expect(screen.getByRole('alert')).toHaveTextContent('Enter when this was paid.')
    expect(screen.getByRole('button', { name: 'Record payment' })).toBeDisabled()
    fireEvent.submit(paidOn().closest('form')!)

    expect(onSave).not.toHaveBeenCalled()
  })
})
