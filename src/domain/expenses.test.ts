import { describe, expect, it } from 'vitest'
import { calculateMemberBalance, calculateSettlements, compareByPaidAtDesc, expensePaidAt, createEqualShares, createExactShares, createExpenseTimestamp, createSettlementPayment, formatExpenseTimestamp, getSettlementRecipientId, isSettlementPayment, memberExpenseNet, money, spendingExpenses } from './expenses'
import type { Expense, Member } from './models'

const alex: Member = { id: 'alex', name: 'Alex', initials: 'AL', color: '#aaa' }
const blair: Member = { id: 'blair', name: 'Blair', initials: 'BL', color: '#bbb' }
const casey: Member = { id: 'casey', name: 'Casey', initials: 'CA', color: '#ccc' }

function expense(overrides: Partial<Expense>): Expense {
  return {
    id: 'expense-1',
    groupId: 'group-1',
    title: 'Shared expense',
    amount: 0,
    payerId: alex.id,
    splitMethod: 'exact',
    shares: {},
    createdAt: 'Today',
    ...overrides,
  }
}

describe('expense domain', () => {
  it('formats positive and negative monetary values as absolute dollars', () => {
    expect(money(12)).toBe('$12.00')
    expect(money(-12.5)).toBe('$12.50')
  })

  it('stores real timestamps and labels the latest create or edit time', () => {
    const formatter = new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    })
    const createdAt = createExpenseTimestamp(new Date('2026-07-15T03:04:00.000Z'))

    expect(createdAt).toBe('2026-07-15T03:04:00.000Z')
    expect(formatExpenseTimestamp(expense({ createdAt }), formatter)).toBe('Created Jul 15, 2026, 3:04 AM')
    expect(formatExpenseTimestamp(expense({ createdAt, updatedAt: '2026-07-16T17:30:00.000Z' }), formatter)).toBe('Edited Jul 16, 2026, 5:30 PM')
    expect(formatExpenseTimestamp(expense({ createdAt: 'Just now' }), formatter)).toBe('Time not recorded')
    expect(formatExpenseTimestamp(expense({ createdAt: 'Friday' }), formatter)).toBe('Friday')
  })

  it('returns no settlements when all balances are already even', () => {
    expect(calculateSettlements([alex, blair], [])).toEqual([])
    expect(calculateSettlements([alex, blair], [expense({
      amount: 0.004,
      payerId: alex.id,
      shares: { [blair.id]: 0.004 },
    })])).toEqual([])
  })

  it('settles multiple debtors against one creditor without losing cents', () => {
    const result = calculateSettlements([alex, blair, casey], [expense({
      amount: 10,
      payerId: alex.id,
      shares: { [alex.id]: 2, [blair.id]: 3, [casey.id]: 5 },
    })])

    expect(result).toEqual([
      { from: blair, to: alex, amount: 3 },
      { from: casey, to: alex, amount: 5 },
    ])
  })

  it('settles one debtor against multiple creditors and treats missing shares as zero', () => {
    const result = calculateSettlements([alex, blair, casey], [
      expense({ id: 'expense-a', amount: 3, payerId: alex.id, shares: { [casey.id]: 3 } }),
      expense({ id: 'expense-b', amount: 5, payerId: blair.id, shares: { [casey.id]: 5 } }),
    ])

    expect(result).toEqual([
      { from: casey, to: alex, amount: 3 },
      { from: casey, to: blair, amount: 5 },
    ])
  })

  it('creates full or partial settlement payments that reduce balances without counting as spending', () => {
    const sharedExpense = expense({ amount: 20, payerId: alex.id, shares: { [blair.id]: 20 } })
    const suggested = calculateSettlements([alex, blair], [sharedExpense])[0]
    const payment = createSettlementPayment('group-1', suggested, 7.346, 'settlement-1', 'Today')

    expect(payment).toEqual({
      id: 'settlement-1',
      groupId: 'group-1',
      title: 'Settlement payment',
      amount: 7.35,
      payerId: blair.id,
      splitMethod: 'exact',
      shares: { [alex.id]: 7.35 },
      createdAt: 'Today',
      kind: 'settlement',
    })
    expect(isSettlementPayment(payment)).toBe(true)
    expect(isSettlementPayment(sharedExpense)).toBe(false)
    expect(getSettlementRecipientId(payment)).toBe(alex.id)
    expect(getSettlementRecipientId(sharedExpense)).toBeNull()
    expect(spendingExpenses([sharedExpense, payment])).toEqual([sharedExpense])
    expect(calculateMemberBalance(blair.id, [sharedExpense, payment])).toBeCloseTo(-12.65)
    expect(calculateSettlements([alex, blair], [sharedExpense, payment])).toEqual([{ from: blair, to: alex, amount: 12.65 }])
  })

  it('rejects zero, negative, and excessive settlement payments', () => {
    const suggested = { from: blair, to: alex, amount: 10 }
    expect(() => createSettlementPayment('group-1', suggested, 0, 'zero')).toThrow(RangeError)
    expect(() => createSettlementPayment('group-1', suggested, -1, 'negative')).toThrow(RangeError)
    expect(() => createSettlementPayment('group-1', suggested, 10.01, 'excessive')).toThrow(RangeError)
    expect(getSettlementRecipientId({ ...expense({}), kind: 'settlement', payerId: alex.id, shares: { [alex.id]: 1 } })).toBeNull()
  })

  it('creates equal shares deterministically down to the final cent', () => {
    expect(createEqualShares([alex, blair, casey], 10)).toEqual({
      alex: 3.34,
      blair: 3.33,
      casey: 3.33,
    })
    expect(createEqualShares([alex, blair], 10)).toEqual({ alex: 5, blair: 5 })
    expect(createEqualShares([], 10)).toEqual({})
  })

  it('creates exact shares and converts missing or invalid values to zero', () => {
    expect(createExactShares([alex, blair, casey], {
      alex: '4.25',
      blair: '',
      casey: 'not-a-number',
    })).toEqual({ alex: 4.25, blair: 0, casey: 0 })
  })

  it('reports one member\'s net effect from a single expense in cents', () => {
    const dinner = expense({ amount: 10, splitMethod: 'equal', shares: { alex: 3.34, blair: 3.33, casey: 3.33 } })

    expect(memberExpenseNet(alex.id, dinner)).toBe(6.66)
    expect(memberExpenseNet(blair.id, dinner)).toBe(-3.33)
    expect(memberExpenseNet('dana', dinner)).toBe(0)
    expect(memberExpenseNet(alex.id, expense({ amount: 0.3, shares: { alex: 0.1, blair: 0.2 } }))).toBe(0.2)
  })

  it('reads the payment time, falling back to when the expense was recorded', () => {
    expect(expensePaidAt(expense({ createdAt: '2026-11-15T20:00:00.000Z' }))).toBe('2026-11-15T20:00:00.000Z')
    expect(expensePaidAt(expense({ createdAt: '2026-11-15T20:00:00.000Z', paidAt: '2026-11-13T19:30:00.000Z' }))).toBe('2026-11-13T19:30:00.000Z')
  })

  it('orders expenses by latest payment, then by latest recording', () => {
    const morning = expense({ id: 'morning', createdAt: '2026-11-15T20:00:00.000Z', paidAt: '2026-11-13T09:00:00.000Z' })
    const evening = expense({ id: 'evening', createdAt: '2026-11-13T19:30:00.000Z' })
    const eveningLater = expense({ id: 'evening-later', createdAt: '2026-11-14T08:00:00.000Z', paidAt: '2026-11-13T19:30:00.000Z' })

    expect([morning, evening, eveningLater].sort(compareByPaidAtDesc).map(item => item.id)).toEqual(['evening-later', 'evening', 'morning'])
    expect(compareByPaidAtDesc(evening, { ...evening, id: 'twin' })).toBe(0)
    expect(compareByPaidAtDesc(expense({ createdAt: 'Just now' }), evening)).toBe(0)
    expect(compareByPaidAtDesc(evening, expense({ createdAt: 'Just now' }))).toBe(0)
    expect(compareByPaidAtDesc(
      expense({ createdAt: 'Just now', paidAt: '2026-11-13T19:30:00.000Z' }),
      eveningLater,
    )).toBe(0)
  })

  it('records a settlement payment time only when one is given', () => {
    const suggested = { from: blair, to: alex, amount: 10 }

    expect(createSettlementPayment('group-1', suggested, 5, 'paid', '2026-11-15T20:00:00.000Z', '2026-11-13T19:30:00.000Z')).toMatchObject({
      createdAt: '2026-11-15T20:00:00.000Z',
      paidAt: '2026-11-13T19:30:00.000Z',
    })
    expect('paidAt' in createSettlementPayment('group-1', suggested, 5, 'unpaid', '2026-11-15T20:00:00.000Z')).toBe(false)
  })
})
