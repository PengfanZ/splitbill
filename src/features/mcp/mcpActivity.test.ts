import { describe, expect, it } from 'vitest'
import { isSharedActivity } from '../sharing/sharedActivity'
import { tokyoActivity, tokyoExpense } from '../../test/mcpFixtures'
import {
  balanceChanges,
  buildExpense,
  createActivitySnapshot,
  describeActivity,
  describeExpense,
  findDuplicate,
  McpToolError,
  planExpenseAdditions,
  resolveMember,
  type ExpenseInput,
} from './mcpActivity'

const now = new Date('2026-10-04T09:30:00.000Z')
const ramen: ExpenseInput = { title: 'Ichiran ramen', amount: 3960, payer: 'Mia', split: { method: 'equal' } }

function sequentialIds() {
  let next = 0
  return () => `expense-agent-${++next}`
}

describe('resolveMember', () => {
  const activity = tokyoActivity()

  it('finds active members by id or by name, ignoring case and spaces', () => {
    expect(resolveMember(activity, 'friend-leo').name).toBe('Leo')
    expect(resolveMember(activity, '  sam ').id).toBe('friend-sam')
  })

  it('refuses removed members, unknown names and ambiguous names', () => {
    expect(() => resolveMember(activity, 'Ana')).toThrow('Ana was removed from Tokyo trip')
    expect(() => resolveMember(activity, 'Zoe')).toThrow('Members: Mia, Leo, Sam.')
    const twins = { ...activity, friends: [...activity.friends, { id: 'friend-leo-2', name: 'leo', initials: 'L', color: '#fff' }], group: { ...activity.group, memberIds: [...activity.group.memberIds, 'friend-leo-2'] } }
    expect(() => resolveMember(twins, 'Leo')).toThrow('Leo (friend-leo), leo (friend-leo-2)')
  })
})

describe('buildExpense', () => {
  const activity = tokyoActivity()

  it('splits equally between every active member by default, rounding like the app', () => {
    expect(buildExpense(activity, { ...ramen, amount: 100 }, 'expense-1', now)).toEqual({
      id: 'expense-1',
      groupId: 'group-tokyo',
      title: 'Ichiran ramen',
      amount: 100,
      payerId: 'me',
      splitMethod: 'equal',
      shares: { me: 33.34, 'friend-leo': 33.33, 'friend-sam': 33.33 },
      createdAt: now.toISOString(),
      categoryId: null,
    })
  })

  it('splits between the named people, on the given day, in the given category', () => {
    const expense = buildExpense(activity, {
      title: '  Taxi to Shinjuku ',
      amount: 2840,
      payer: 'Leo',
      split: { method: 'equal', participants: ['Leo', 'Sam'] },
      category: 'transport',
      date: '2026-09-21',
    }, 'expense-2', now)
    expect(expense).toMatchObject({
      title: 'Taxi to Shinjuku',
      payerId: 'friend-leo',
      shares: { 'friend-leo': 1420, 'friend-sam': 1420 },
      createdAt: '2026-09-21T12:00:00.000Z',
      categoryId: 'transport',
    })
    expect(buildExpense(activity, { ...ramen, category: 'food & DRINKS' }, 'e', now).categoryId).toBe('food')
    expect(buildExpense(activity, { ...ramen, category: 'General' }, 'e', now).categoryId).toBeNull()
    expect(buildExpense(activity, { ...ramen, category: ' ' }, 'e', now).categoryId).toBeNull()
    expect(buildExpense(activity, { ...ramen, date: '2026-09-21T22:15:00+09:00' }, 'e', now).createdAt).toBe('2026-09-21T13:15:00.000Z')
  })

  it('keeps exact shares when they add up to the amount', () => {
    const expense = buildExpense(activity, {
      title: 'Hotel deposit',
      amount: 30000.5,
      payer: 'me',
      split: { method: 'exact', shares: { Mia: 10000.5, Leo: 20000, Sam: 0 } },
    }, 'expense-3', now)
    expect(expense.splitMethod).toBe('exact')
    expect(expense.shares).toEqual({ me: 10000.5, 'friend-leo': 20000, 'friend-sam': 0 })
  })

  it('explains every invalid expense instead of saving it', () => {
    const invalid: [Partial<ExpenseInput>, string][] = [
      [{ title: ' ' }, 'needs a title'],
      [{ amount: 10.005 }, 'at most two decimal places'],
      [{ amount: Number.NaN }, 'at most two decimal places'],
      [{ amount: 0 }, 'must be above 0'],
      [{ amount: 2_000_000_000 }, 'must be above 0'],
      [{ split: { method: 'equal', participants: ['Leo', 'leo'] } }, 'only once'],
      [{ split: { method: 'exact', shares: {} } }, 'needs at least one person'],
      [{ split: { method: 'exact', shares: { Mia: 3000, Leo: 960.001 } } }, "Leo's share"],
      [{ split: { method: 'exact', shares: { Mia: 4000, Leo: -40 } } }, "can't be negative"],
      [{ split: { method: 'exact', shares: { Mia: 3000, Leo: 900 } } }, 'add up to 3900, not 3960'],
      [{ category: 'Groceries' }, 'Categories: General, Food & drinks, Stay, Transport, Activities.'],
      [{ date: '2026-02-30' }, 'not a valid date'],
      [{ date: 'yesterday' }, 'not a valid date'],
    ]
    for (const [change, message] of invalid) {
      const attempt = () => buildExpense(activity, { ...ramen, ...change }, 'e', now)
      expect(attempt).toThrow(McpToolError)
      expect(attempt).toThrow(message)
    }
  })
})

describe('findDuplicate', () => {
  const existing = tokyoExpense()

  it('matches the same amount on the same day with a similar title', () => {
    expect(findDuplicate([existing], tokyoExpense({ id: 'new', title: 'SUICA top up' }))).toBe(existing)
    expect(findDuplicate([existing], tokyoExpense({ id: 'new', title: 'Suica' }))).toBe(existing)
    expect(findDuplicate([existing], tokyoExpense({ id: 'new', title: 'Mobile Suica top-up at station' }))).toBe(existing)
    // Regression: an agent rewrote the statement line SUICA MOBILE TOPUP and the existing top-up was added again.
    expect(findDuplicate([existing], tokyoExpense({ id: 'new', title: 'Suica mobile top-up' }))).toBe(existing)
    expect(findDuplicate([existing], tokyoExpense({ id: 'new', title: 'SUICA MOBILE TOPUP' }))).toBe(existing)
  })

  it('ignores other amounts, days, unrelated titles and settlements', () => {
    expect(findDuplicate([existing], tokyoExpense({ id: 'new', amount: 5001 }))).toBeNull()
    // Friends often buy the same thing on the same day; each person's own purchase is not a duplicate.
    expect(findDuplicate([existing], tokyoExpense({ id: 'new', payerId: 'friend-leo' }))).toBeNull()
    expect(findDuplicate([existing], tokyoExpense({ id: 'new', createdAt: '2026-09-21T03:00:00.000Z' }))).toBeNull()
    expect(findDuplicate([existing], tokyoExpense({ id: 'new', title: 'Taxi' }))).toBeNull()
    expect(findDuplicate([existing], tokyoExpense({ id: 'new', title: 'Su' }))).toBeNull()
    const dinner = tokyoExpense({ title: 'Dinner with the team' })
    expect(findDuplicate([dinner], tokyoExpense({ id: 'new', title: 'Lunch with the kids' }))).toBeNull()
    const settlement = tokyoExpense({ kind: 'settlement', splitMethod: 'exact', shares: { 'friend-leo': 5000 } })
    expect(findDuplicate([settlement], tokyoExpense({ id: 'new' }))).toBeNull()
  })
})

describe('planExpenseAdditions', () => {
  it('adds new expenses first, in order, and skips likely duplicates', () => {
    const activity = tokyoActivity()
    const plan = planExpenseAdditions(activity, [
      ramen,
      { title: 'Suica top-up', amount: 5000, payer: 'Mia', split: { method: 'equal' }, date: '2026-09-20' },
      { title: 'teamLab tickets', amount: 11400, payer: 'Mia', split: { method: 'equal' } },
      { ...ramen },
    ], { allowDuplicates: false, now, makeId: sequentialIds() })

    expect(plan.saved.map(expense => expense.title)).toEqual(['Ichiran ramen', 'teamLab tickets'])
    expect(plan.skipped.map(item => [item.expense.title, item.duplicateOf.id])).toEqual([
      ['Suica top-up', 'expense-suica'],
      ['Ichiran ramen', 'expense-agent-1'],
    ])
    expect(plan.activity.expenses.map(expense => expense.id)).toEqual(['expense-agent-1', 'expense-agent-3', 'expense-suica'])
    expect(isSharedActivity(plan.activity)).toBe(true)
  })

  it('saves repeats when duplicates are allowed', () => {
    const plan = planExpenseAdditions(tokyoActivity(), [ramen, ramen], { allowDuplicates: true, now, makeId: sequentialIds() })
    expect(plan.saved).toHaveLength(2)
    expect(plan.skipped).toEqual([])
  })

  it('leaves the activity untouched when everything was a duplicate', () => {
    const activity = tokyoActivity()
    const plan = planExpenseAdditions(activity, [{ title: 'Suica', amount: 5000, payer: 'Mia', split: { method: 'equal' }, date: '2026-09-20' }], { allowDuplicates: false, now, makeId: sequentialIds() })
    expect(plan.saved).toEqual([])
    expect(plan.activity.expenses).toEqual(activity.expenses)
  })

  it('refuses a batch that would exceed the activity limits', () => {
    const full = tokyoActivity(Array.from({ length: 1000 }, (_, index) => tokyoExpense({ id: `expense-${index}` })))
    expect(() => planExpenseAdditions(full, [ramen], { allowDuplicates: false, now, makeId: sequentialIds() })).toThrow('size limits')
  })
})

describe('describing activities', () => {
  it('summarizes members, balances and settlements by name', () => {
    const activity = tokyoActivity([
      tokyoExpense(),
      tokyoExpense({ id: 'settle', title: 'Settlement payment', kind: 'settlement', amount: 1000, payerId: 'friend-leo', splitMethod: 'exact', shares: { me: 1000 }, categoryId: undefined }),
    ])
    expect(describeActivity(activity, 'friend-sam')).toEqual({
      name: 'Tokyo trip',
      currency: 'JPY',
      you: 'Sam',
      members: [
        { id: 'me', name: 'Mia', active: true },
        { id: 'friend-leo', name: 'Leo', active: true },
        { id: 'friend-sam', name: 'Sam', active: true },
        { id: 'friend-ana', name: 'Ana', active: false },
      ],
      categories: ['General', 'Food & drinks', 'Stay', 'Transport', 'Activities'],
      totalSpending: 5000,
      balances: [
        { member: 'Mia', balance: 2333.33 },
        { member: 'Leo', balance: -666.67 },
        { member: 'Sam', balance: -1666.66 },
        { member: 'Ana', balance: 0 },
      ],
      suggestedSettlements: [
        { from: 'Leo', to: 'Mia', amount: 666.67 },
        { from: 'Sam', to: 'Mia', amount: 1666.66 },
      ],
    })
    expect(describeExpense(activity, activity.expenses[1])).toMatchObject({ kind: 'settlement', paidBy: 'Leo', category: 'General', split: [{ member: 'Mia', amount: 1000 }] })
  })

  it('uses custom categories and falls back to ids for unknown members', () => {
    const activity = tokyoActivity()
    activity.group.categories = [{ id: 'snacks', name: 'Snacks', color: '#719d86' }]
    expect(describeActivity(activity, 'gone').you).toBe('gone')
    expect(describeActivity(activity, 'me').categories).toEqual(['General', 'Snacks'])
    expect(describeExpense(activity, tokyoExpense({ categoryId: 'snacks' })).category).toBe('Snacks')
  })

  it('reports how each balance moved', () => {
    const before = tokyoActivity()
    const after = planExpenseAdditions(before, [{ ...ramen, amount: 300 }], { allowDuplicates: false, now, makeId: sequentialIds() }).activity
    expect(balanceChanges(before, after)).toEqual([
      { member: 'Mia', change: 200 },
      { member: 'Leo', change: -100 },
      { member: 'Sam', change: -100 },
    ])
  })
})

describe('createActivitySnapshot', () => {
  const ids = () => {
    let next = 0
    return (prefix: string) => `${prefix}-${++next}`
  }

  it('creates a valid Live snapshot with the creator as me and no duplicate names', () => {
    const activity = createActivitySnapshot({
      name: ' Ski weekend ',
      creatorName: 'Mia',
      memberNames: ['Leo', 'Sam, Ana', 'leo', 'mia'],
      currency: 'CAD',
    }, ids())
    expect(isSharedActivity(activity)).toBe(true)
    expect(activity.sender).toEqual({ id: 'me', name: 'Mia', initials: 'M', color: '#ead1b9' })
    expect(activity.group).toEqual({
      id: 'group-4',
      name: 'Ski weekend',
      emoji: '✈',
      memberIds: ['me', 'friend-1', 'friend-2', 'friend-3'],
      currency: 'CAD',
    })
    expect(activity.friends.map(friend => friend.name)).toEqual(['Leo', 'Sam', 'Ana'])
    expect(createActivitySnapshot({ name: 'Solo', creatorName: 'Mia', memberNames: [], currency: 'USD', emoji: '⛷' }, ids()).group.emoji).toBe('⛷')
  })

  it('rejects names and members Tally cannot store', () => {
    const base = { name: 'Trip', creatorName: 'Mia', memberNames: ['Leo'], currency: 'USD' as const }
    expect(() => createActivitySnapshot({ ...base, name: ' ' }, ids())).toThrow('activity name')
    expect(() => createActivitySnapshot({ ...base, creatorName: '' }, ids())).toThrow('Your name')
    expect(() => createActivitySnapshot({ ...base, memberNames: ['x'.repeat(121)] }, ids())).toThrow('at most 120')
    expect(() => createActivitySnapshot({ ...base, emoji: 'x'.repeat(17) }, ids())).toThrow('not valid')
  })
})
