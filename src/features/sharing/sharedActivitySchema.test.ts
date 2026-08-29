import { describe, expect, it } from 'vitest'
import { CURRENT_USER } from '../../domain/members'
import { MAX_ACTIVITY_EXPENSES, sharedActivitySchema } from './sharedActivitySchema'

describe('shared activity schema', () => {
  const friend = { id: 'maya', name: 'Maya', initials: 'M', color: '#abc' }
  const expense = {
    id: 'dinner',
    groupId: 'trip',
    title: 'Dinner',
    amount: 10,
    payerId: 'me',
    splitMethod: 'equal',
    shares: { me: 5, maya: 5 },
    createdAt: '2026-07-29T01:00:00.000Z',
    updatedAt: '2026-07-29T02:00:00.000Z',
  }
  const activity = {
    version: 2,
    sender: CURRENT_USER,
    group: { id: 'trip', name: 'Trip', emoji: '✦', memberIds: ['me', 'maya'] },
    friends: [friend],
    expenses: [expense],
  }

  it('validates participant references and optional expense timestamps', () => {
    expect(sharedActivitySchema.safeParse(activity).success).toBe(true)
    expect(sharedActivitySchema.safeParse({
      ...activity,
      expenses: [{ ...expense, updatedAt: 'not-a-date' }],
    }).success).toBe(false)
    expect(sharedActivitySchema.safeParse({
      ...activity,
      expenses: [{ ...expense, createdAt: 'not-a-date' }],
    }).success).toBe(false)
    expect(sharedActivitySchema.safeParse({
      ...activity,
      group: { ...activity.group, memberIds: ['me', 'missing'] },
    }).success).toBe(false)
    expect(sharedActivitySchema.safeParse({
      ...activity,
      expenses: [{ ...expense, groupId: 'other' }],
    }).success).toBe(false)
    expect(sharedActivitySchema.safeParse({
      ...activity,
      expenses: [{ ...expense, payerId: 'missing' }],
    }).success).toBe(false)
    expect(sharedActivitySchema.safeParse({
      ...activity,
      expenses: [{ ...expense, shares: { me: 5, missing: 5 } }],
    }).success).toBe(false)
  })

  it('rejects ambiguous identities and participant sets', () => {
    expect(sharedActivitySchema.safeParse({
      ...activity,
      sender: { ...CURRENT_USER, id: 'someone-else' },
    }).success).toBe(false)
    expect(sharedActivitySchema.safeParse({
      ...activity,
      friends: [friend, { ...friend }],
    }).success).toBe(false)
    expect(sharedActivitySchema.safeParse({
      ...activity,
      group: { ...activity.group, memberIds: ['me', 'maya', 'maya'] },
    }).success).toBe(false)
    expect(sharedActivitySchema.safeParse({
      ...activity,
      group: { ...activity.group, memberIds: ['me'] },
    }).success).toBe(false)
    expect(sharedActivitySchema.safeParse({
      ...activity,
      expenses: [expense, { ...expense }],
    }).success).toBe(false)
  })

  it('rejects invalid amounts and incomplete split totals', () => {
    const invalidExpenses = [
      { ...expense, amount: -1, shares: { me: -0.5, maya: -0.5 } },
      { ...expense, shares: {} },
      { ...expense, shares: { me: 4, maya: 5 } },
      { ...expense, shares: { me: 5, maya: -1 } },
    ]
    invalidExpenses.forEach(invalidExpense => {
      expect(sharedActivitySchema.safeParse({ ...activity, expenses: [invalidExpense] }).success).toBe(false)
    })
  })

  it('accepts only well-formed settlement payments', () => {
    const settlement = {
      ...expense,
      kind: 'settlement',
      payerId: 'maya',
      splitMethod: 'exact',
      amount: 5,
      shares: { me: 5 },
    }

    expect(sharedActivitySchema.safeParse({ ...activity, expenses: [settlement] }).success).toBe(true)
    const invalidSettlements = [
      { ...settlement, amount: 0 },
      { ...settlement, splitMethod: 'equal' },
      { ...settlement, shares: {} },
      { ...settlement, shares: { me: 5, maya: 0 } },
      { ...settlement, payerId: 'me' },
      { ...settlement, shares: { me: 4 } },
    ]
    invalidSettlements.forEach(invalidSettlement => {
      expect(sharedActivitySchema.safeParse({ ...activity, expenses: [invalidSettlement] }).success).toBe(false)
    })
  })

  it('rejects a structurally valid snapshot above the total byte limit', () => {
    const oversizedActivity = {
      version: 2,
      sender: CURRENT_USER,
      group: { id: 'trip', name: 'Trip', emoji: '✦', memberIds: ['me'] },
      friends: [],
      expenses: Array.from({ length: MAX_ACTIVITY_EXPENSES }, (_, index) => ({
        id: `expense-${index}`,
        groupId: 'trip',
        title: 'x'.repeat(200),
        amount: 1,
        payerId: 'me',
        splitMethod: 'equal',
        shares: { me: 1 },
        createdAt: '2026-07-29T01:00:00.000Z',
      })),
    }

    expect(sharedActivitySchema.safeParse(oversizedActivity).success).toBe(false)
  })

  it('accepts supported activity currencies and rejects unknown codes', () => {
    const activity = {
      version: 2,
      sender: CURRENT_USER,
      group: { id: 'trip', name: 'Trip', emoji: '✦', memberIds: ['me'], currency: 'CNY' },
      friends: [],
      expenses: [],
    }

    expect(sharedActivitySchema.safeParse(activity).success).toBe(true)
    expect(sharedActivitySchema.safeParse({
      ...activity,
      group: { ...activity.group, currency: 'BTC' },
    }).success).toBe(false)
  })
})
