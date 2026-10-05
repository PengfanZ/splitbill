import { describe, expect, it } from 'vitest'
import { isSharedActivity } from '../sharing/sharedActivity'
import { tokyoActivity, tokyoExpense } from '../../test/mcpFixtures'
import {
  balanceChanges,
  buildExpense,
  buildSettlement,
  createActivitySnapshot,
  describeActivity,
  describeExpense,
  findDuplicate,
  McpToolError,
  planExpenseAdditions,
  planExpenseDeletion,
  planExpenseUpdate,
  planMemberAdditions,
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

describe('expense versions', () => {
  it('uses the last edit time, or the creation time for an expense never edited', () => {
    const activity = tokyoActivity()
    expect(describeExpense(activity, tokyoExpense()).version).toBe('2026-09-20T03:00:00.000Z')
    expect(describeExpense(activity, tokyoExpense({ updatedAt: '2026-09-25T08:00:00.000Z' })).version).toBe('2026-09-25T08:00:00.000Z')
  })
})

describe('buildSettlement', () => {
  it('records a payment the same way the app does', () => {
    expect(buildSettlement(tokyoActivity(), { from: 'Leo', to: 'mia', amount: 1000, date: '2026-09-21' }, 'payment-1', now)).toEqual({
      id: 'payment-1',
      groupId: 'group-tokyo',
      title: 'Settlement payment',
      amount: 1000,
      payerId: 'friend-leo',
      splitMethod: 'exact',
      shares: { me: 1000 },
      createdAt: '2026-09-21T12:00:00.000Z',
      kind: 'settlement',
    })
    expect(buildSettlement(tokyoActivity(), { from: 'Sam', to: 'Mia', amount: 1666.66 }, 'payment-2', now).createdAt).toBe(now.toISOString())
  })

  it('lets a removed friend settle what they still owe', () => {
    const activity = tokyoActivity([tokyoExpense({ id: 'dinner', title: 'Dinner', amount: 3000, shares: { me: 1500, 'friend-ana': 1500 } })])
    expect(buildSettlement(activity, { from: 'Ana', to: 'Mia', amount: 1500 }, 'payment-1', now)).toMatchObject({ payerId: 'friend-ana', shares: { me: 1500 } })
  })

  it('refuses payments that do not match who owes whom', () => {
    const activity = tokyoActivity()
    const settle = (from: string, to: string, amount: number) => () => buildSettlement(activity, { from, to, amount }, 'payment-1', now)
    expect(settle('Leo', 'Leo', 100)).toThrow('A payment needs two different people.')
    expect(settle('Mia', 'Leo', 100)).toThrow("Mia doesn't owe anything in Tokyo trip.")
    expect(settle('Leo', 'Sam', 100)).toThrow("Sam isn't owed anything in Tokyo trip.")
    expect(settle('Leo', 'Mia', 1666.68)).toThrow('Leo owes 1666.67 in Tokyo trip, less than 1666.68.')
    expect(settle('Leo', 'Mia', 0)).toThrow('must be above 0')
    expect(settle('Leo', 'Mia', 1.234)).toThrow('at most two decimal places')

    // Sam owes 1300 overall, but Leo is owed only 300 of it.
    const twoLenders = tokyoActivity([
      tokyoExpense({ id: 'tickets', payerId: 'friend-leo', amount: 300, shares: { 'friend-sam': 300 } }),
      tokyoExpense({ id: 'hotel', amount: 1000, shares: { 'friend-sam': 1000 } }),
    ])
    expect(() => buildSettlement(twoLenders, { from: 'Sam', to: 'Leo', amount: 500 }, 'payment-1', now)).toThrow('Leo is owed 300 in Tokyo trip, less than 500.')
  })
})

describe('planMemberAdditions', () => {
  function friendIds() {
    let next = 0
    return (prefix: string) => `${prefix}-agent-${++next}`
  }

  it('adds new friends, restores removed ones and reports who was already there', () => {
    const plan = planMemberAdditions(tokyoActivity(), ['Kenji', ' ana ', 'leo', 'kenji', 'Yui'], friendIds())
    expect(plan.added).toEqual(['Kenji', 'Yui'])
    expect(plan.restored).toEqual(['Ana'])
    expect(plan.alreadyIn).toEqual(['Leo'])
    expect(plan.activity.friends.slice(3)).toEqual([
      { id: 'friend-agent-1', name: 'Kenji', initials: 'K', color: '#f3d9da' },
      { id: 'friend-agent-2', name: 'Yui', initials: 'Y', color: '#d7e6ee' },
    ])
    expect(plan.activity.group.memberIds).toEqual(['me', 'friend-leo', 'friend-sam', 'friend-ana', 'friend-agent-1', 'friend-agent-2'])
    // Live saves must keep the list once it exists, even when it is empty.
    expect(plan.activity.group.inactiveMemberIds).toEqual([])
    expect(isSharedActivity(plan.activity)).toBe(true)
  })

  it('leaves the activity untouched when everyone is already in it', () => {
    const activity = tokyoActivity()
    const plan = planMemberAdditions(activity, ['Mia', 'Sam'], friendIds())
    expect(plan).toEqual({ activity, added: [], restored: [], alreadyIn: ['Mia', 'Sam'] })
  })

  it('refuses names Tally cannot store', () => {
    expect(() => planMemberAdditions(tokyoActivity(), [' '], friendIds())).toThrow('Give at least one name.')
    expect(() => planMemberAdditions(tokyoActivity(), ['x'.repeat(121)], friendIds())).toThrow('at most 120 characters')
    const crowd = Array.from({ length: 98 }, (_, index) => `Friend ${index}`)
    expect(() => planMemberAdditions(tokyoActivity(), crowd, friendIds())).toThrow("Tokyo trip would exceed Tally's size limits with these people.")
  })
})

describe('planExpenseUpdate', () => {
  const version = '2026-09-20T03:00:00.000Z'

  it('re-splits a new amount between the same people and keeps everything else', () => {
    const plan = planExpenseUpdate(tokyoActivity(), 'expense-suica', version, { amount: 6000 }, now)
    expect(plan.before).toEqual(tokyoExpense())
    expect(plan.after).toEqual(tokyoExpense({ amount: 6000, shares: { me: 2000, 'friend-leo': 2000, 'friend-sam': 2000 }, updatedAt: now.toISOString() }))
    expect(plan.activity.expenses).toEqual([plan.after])
  })

  it('changes the title, payer, day and category without touching the split', () => {
    const { after } = planExpenseUpdate(tokyoActivity(), 'expense-suica', version, { title: ' Suica card ', payer: 'Leo', date: '2026-09-21', category: 'general' }, now)
    expect(after).toEqual(tokyoExpense({ title: 'Suica card', payerId: 'friend-leo', createdAt: '2026-09-21T12:00:00.000Z', categoryId: null, updatedAt: now.toISOString() }))
  })

  it('replaces the split when a new one is given', () => {
    const { after } = planExpenseUpdate(tokyoActivity(), 'expense-suica', version, { split: { method: 'exact', shares: { Mia: 2500, Leo: 2500 } } }, now)
    expect(after).toMatchObject({ amount: 5000, splitMethod: 'exact', shares: { me: 2500, 'friend-leo': 2500 } })
  })

  it('keeps removed friends on expenses they were already part of, but adds no new ones', () => {
    const dinner = tokyoExpense({ id: 'dinner', title: 'Dinner', amount: 3000, payerId: 'friend-ana', shares: { me: 1500, 'friend-ana': 1500 } })
    const { after } = planExpenseUpdate(tokyoActivity([dinner]), 'dinner', version, { amount: 3200 }, now)
    expect(after).toMatchObject({ payerId: 'friend-ana', shares: { me: 1600, 'friend-ana': 1600 } })
    expect(() => planExpenseUpdate(tokyoActivity(), 'expense-suica', version, { split: { method: 'equal', participants: ['Mia', 'Ana'] } }, now))
      .toThrow('Ana was removed from Tokyo trip')
  })

  it('refuses edits it cannot apply safely', () => {
    const edit = (activity: ReturnType<typeof tokyoActivity>, id: string, changes: Parameters<typeof planExpenseUpdate>[3], expected = version) => () => planExpenseUpdate(activity, id, expected, changes, now)
    expect(edit(tokyoActivity(), 'expense-suica', {})).toThrow('Say what to change.')
    expect(edit(tokyoActivity(), 'nope', { amount: 1 })).toThrow('No expense with id "nope" in Tokyo trip')
    expect(edit(tokyoActivity(), 'expense-suica', { title: ' ' })).toThrow('title of 1 to 200 characters')
    const exact = tokyoActivity([tokyoExpense({ splitMethod: 'exact', shares: { me: 4000, 'friend-leo': 1000 } })])
    expect(edit(exact, 'expense-suica', { amount: 6000 })).toThrow('"Suica top-up" has an exact split, so give the new split along with the new amount.')
    const payment = tokyoActivity([tokyoExpense({ title: 'Settlement payment', kind: 'settlement', payerId: 'friend-leo', splitMethod: 'exact', shares: { me: 1000 }, amount: 1000 })])
    expect(edit(payment, 'expense-suica', { amount: 500 })).toThrow('record_settlement')
  })

  it('saves nothing when the expense changed since the agent read it, and shows the current version', () => {
    const edited = tokyoActivity([tokyoExpense({ title: 'Suica (edited)', updatedAt: '2026-09-25T08:00:00.000Z' })])
    let message = ''
    try {
      planExpenseUpdate(edited, 'expense-suica', version, { amount: 6000 }, now)
    } catch (error) {
      expect(error).toBeInstanceOf(McpToolError)
      message = (error as Error).message
    }
    expect(message).toContain('"Suica (edited)" changed since you read it, so nothing was saved.')
    expect(message).toContain('"version":"2026-09-25T08:00:00.000Z"')
    expect(planExpenseUpdate(edited, 'expense-suica', '2026-09-25T08:00:00.000Z', { amount: 6000 }, now).after.amount).toBe(6000)
  })
})

describe('planExpenseDeletion', () => {
  it('removes only the named expense, when it has not changed', () => {
    const keep = tokyoExpense({ id: 'keep', title: 'Taxi' })
    const plan = planExpenseDeletion(tokyoActivity([keep, tokyoExpense()]), 'expense-suica', '2026-09-20T03:00:00.000Z')
    expect(plan.deleted).toEqual(tokyoExpense())
    expect(plan.activity.expenses).toEqual([keep])
    expect(() => planExpenseDeletion(tokyoActivity(), 'expense-suica', '2026-09-19T00:00:00.000Z')).toThrow('changed since you read it')
    expect(() => planExpenseDeletion(tokyoActivity(), 'gone', '2026-09-20T03:00:00.000Z')).toThrow('No expense with id "gone"')
  })
})
