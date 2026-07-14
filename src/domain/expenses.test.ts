import { describe, expect, it } from 'vitest'
import { calculateMemberBalance, calculateSettlements, createEqualShares, createExactShares, createSettlementPayment, getSettlementRecipientId, isSettlementPayment, money, spendingExpenses } from './expenses'
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
})
