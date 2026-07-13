import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App, {
  calculateSettlements,
  CURRENT_USER,
  ExpenseModal,
  parseState,
  STORAGE_KEY,
  type ActivityGroup,
  type Expense,
  type Member,
  type PersistedState,
} from './App'

const maya: Member = { id: 'maya', name: 'Maya', initials: 'M', color: '#d6e8dc' }
const jordan: Member = { id: 'jordan', name: 'Jordan', initials: 'J', color: '#d8dde8' }
const sam: Member = { id: 'sam', name: 'Sam', initials: 'S', color: '#f6d5bd' }
const trip: ActivityGroup = { id: 'trip', name: 'Summer trip', emoji: '✦', memberIds: ['me', 'maya', 'jordan'] }

const realisticExpenses: Expense[] = [
  { id: 'dinner', groupId: 'trip', title: 'Dinner', amount: 90, payerId: 'me', splitMethod: 'equal', shares: { me: 30, maya: 30, jordan: 30 }, createdAt: 'Friday' },
  { id: 'taxi', groupId: 'trip', title: 'Taxi', amount: 30, payerId: 'maya', splitMethod: 'equal', shares: { me: 10, maya: 10, jordan: 10 }, createdAt: 'Saturday' },
  { id: 'hotel', groupId: 'trip', title: 'Hotel', amount: 120, payerId: 'jordan', splitMethod: 'exact', shares: { me: 40, maya: 30, jordan: 50 }, createdAt: 'Sunday' },
]

const persistedTrip: PersistedState = {
  groups: [trip],
  friends: [maya, jordan],
  expenses: realisticExpenses,
  selectedGroupId: trip.id,
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})

describe('happy paths', () => {
  it('shows a realistic three-person trip and recalculates correctly after deleting one expense', async () => {
    const user = userEvent.setup()
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persistedTrip))
    render(<App />)

    const summary = screen.getByLabelText('Activity summary')
    expect(within(summary).getByText('$240.00')).toBeVisible()
    expect(within(summary).getByText('$90.00')).toBeVisible()
    expect(within(summary).getByText('+$10.00')).toBeVisible()
    expect(screen.getByText('Maya owes You').closest('.balance-row')).toHaveTextContent('$10.00')
    expect(screen.getByText('Maya owes Jordan').closest('.balance-row')).toHaveTextContent('$30.00')
    expect(screen.getByText('Dinner')).toBeVisible()
    expect(screen.getByText('Taxi')).toBeVisible()
    expect(screen.getByText('Hotel')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Delete Hotel' }))

    expect(within(summary).getByText('$120.00')).toBeVisible()
    expect(within(summary).getByText('+$50.00')).toBeVisible()
    expect(screen.queryByText('Hotel')).not.toBeInTheDocument()
    expect(screen.getByText('Maya owes You').closest('.balance-row')).toHaveTextContent('$10.00')
    expect(screen.getByText('Jordan owes You').closest('.balance-row')).toHaveTextContent('$40.00')
    await waitFor(() => expect(parseState(localStorage.getItem(STORAGE_KEY)).expenses).toHaveLength(2))
  })

  it('creates an exact split paid by a friend and shows who the current user owes', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Create an activity' }))
    await user.type(screen.getByLabelText('Activity name'), 'Weekend')
    await user.type(screen.getByLabelText(/Add friends/), 'Maya')
    await user.click(screen.getByRole('button', { name: 'Create activity' }))
    await user.click(screen.getByRole('button', { name: 'Add expense' }))
    await user.type(screen.getByLabelText('Description'), 'Cabin')
    await user.type(screen.getByLabelText('Amount'), '100')
    await user.selectOptions(screen.getByLabelText('Paid by'), 'Maya')
    await user.selectOptions(screen.getByLabelText('Split method'), 'exact')
    await user.type(screen.getByLabelText('You share'), '60')
    await user.type(screen.getByLabelText('Maya share'), '40')
    await user.click(screen.getByRole('button', { name: 'Save expense' }))

    expect(screen.getByText('You owe Maya')).toBeVisible()
    expect(screen.getByText('$60.00')).toBeVisible()
    expect(screen.getByText('−$60.00')).toBeVisible()
    expect(screen.getByText('Cabin')).toBeVisible()
  })

  it('keeps earlier splits unchanged when a friend joins and includes them in future expenses', async () => {
    const user = userEvent.setup()
    const originalExpense: Expense = {
      id: 'groceries',
      groupId: 'trip',
      title: 'Groceries',
      amount: 40,
      payerId: 'me',
      splitMethod: 'equal',
      shares: { me: 20, maya: 20 },
      createdAt: 'Monday',
    }
    const twoPersonTrip: PersistedState = {
      groups: [{ ...trip, memberIds: ['me', 'maya'] }],
      friends: [maya],
      expenses: [originalExpense],
      selectedGroupId: trip.id,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(twoPersonTrip))
    const { unmount } = render(<App />)

    expect(screen.getByText((_, node) => node?.textContent === 'You paidSplit equally · 2 people')).toBeVisible()
    expect(screen.getByText('+$20.00')).toBeVisible()
    await user.click(screen.getAllByRole('button', { name: 'Add friend' })[0])
    expect(screen.getByText('Future expenses only')).toBeVisible()
    expect(screen.getByText('1 existing expense will stay unchanged.')).toBeVisible()
    await user.type(screen.getByLabelText(/Friend names/), 'Jordan')
    await user.click(screen.getByRole('button', { name: 'Add friends' }))

    expect(screen.getByRole('status')).toHaveTextContent('Jordan was added for future expenses. 1 earlier expense was left unchanged.')
    expect(screen.getByText('+$20.00')).toBeVisible()
    expect(screen.getByText((_, node) => node?.textContent === 'You paidSplit equally · 2 people')).toBeVisible()
    await waitFor(() => {
      const saved = parseState(localStorage.getItem(STORAGE_KEY))
      expect(saved.expenses[0].shares).toEqual({ me: 20, maya: 20 })
    })

    await user.click(screen.getByRole('button', { name: 'Add expense' }))
    expect(screen.getByRole('option', { name: 'Jordan' })).toBeVisible()
    await user.type(screen.getByLabelText('Description'), 'Parking')
    await user.type(screen.getByLabelText('Amount'), '30')
    await user.click(screen.getByRole('button', { name: 'Save expense' }))

    expect(screen.getByText((_, node) => node?.textContent === 'You paidSplit equally · 3 people')).toBeVisible()
    expect(screen.getByText('Jordan owes You').closest('.balance-row')).toHaveTextContent('$10.00')
    await waitFor(() => {
      const saved = parseState(localStorage.getItem(STORAGE_KEY))
      expect(saved.expenses.find(item => item.id === 'groceries')?.shares).toEqual({ me: 20, maya: 20 })
      expect(saved.expenses.find(item => item.title === 'Parking')?.shares).toEqual({ me: 10, maya: 10, [saved.friends[1].id]: 10 })
    })

    unmount()
    render(<App />)
    expect(screen.getByText('3 people sharing expenses together.')).toBeVisible()
    expect(screen.getByText((_, node) => node?.textContent === 'You paidSplit equally · 2 people')).toBeVisible()
    expect(screen.getByText((_, node) => node?.textContent === 'You paidSplit equally · 3 people')).toBeVisible()
  })
})

describe('edge cases', () => {
  it.each([
    ['0.01', { me: 0.01, maya: 0, jordan: 0 }],
    ['0.02', { me: 0.01, maya: 0.01, jordan: 0 }],
    ['10.00', { me: 3.34, maya: 3.33, jordan: 3.33 }],
  ])('keeps an equal split of $%s exact down to the cent', async (amount, expectedShares) => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<ExpenseModal group={trip} members={[CURRENT_USER, maya, jordan]} onClose={vi.fn()} onSave={onSave} />)

    await user.type(screen.getByLabelText('Description'), 'Small charge')
    await user.type(screen.getByLabelText('Amount'), amount)
    await user.click(screen.getByRole('button', { name: 'Save expense' }))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ shares: expectedShares }))
    expect(Object.values(onSave.mock.calls[0][0].shares as Record<string, number>).reduce((sum, share) => sum + share, 0)).toBe(Number(amount))
  })

  it('accepts the floating-point exact split 0.10 + 0.20 for a 0.30 expense', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<ExpenseModal group={trip} members={[CURRENT_USER, maya]} onClose={vi.fn()} onSave={onSave} />)

    await user.type(screen.getByLabelText('Description'), 'Tiny split')
    await user.type(screen.getByLabelText('Amount'), '0.30')
    await user.selectOptions(screen.getByLabelText('Split method'), 'exact')
    await user.type(screen.getByLabelText('You share'), '0.10')
    await user.type(screen.getByLabelText('Maya share'), '0.20')

    expect(screen.getByRole('button', { name: 'Save expense' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Save expense' }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ shares: { me: 0.1, maya: 0.2 } }))
  })

  it('settles multiple debtors without creating or losing a cent', () => {
    const members = [CURRENT_USER, maya, jordan, sam]
    const expenses: Expense[] = [
      { id: 'a', groupId: 'trip', title: 'Rental', amount: 100, payerId: 'me', splitMethod: 'exact', shares: { me: 25, maya: 25, jordan: 25, sam: 25 }, createdAt: 'Today' },
      { id: 'b', groupId: 'trip', title: 'Fuel', amount: 30, payerId: 'maya', splitMethod: 'exact', shares: { me: 10, maya: 10, jordan: 10, sam: 0 }, createdAt: 'Today' },
    ]

    const settlements = calculateSettlements(members, expenses)
    const totalSettledCents = settlements.reduce((sum, settlement) => sum + Math.round(settlement.amount * 100), 0)

    expect(settlements).toEqual([
      { from: maya, to: CURRENT_USER, amount: 5 },
      { from: jordan, to: CURRENT_USER, amount: 35 },
      { from: sam, to: CURRENT_USER, amount: 25 },
    ])
    expect(totalSettledCents).toBe(6500)
    expect(settlements.every(settlement => Number.isInteger(settlement.amount * 100) && settlement.amount > 0)).toBe(true)
  })
})
