import { describe, expect, it } from 'vitest'
import { CURRENT_USER } from './members'
import { memberExpenseReferences, removeActivityFriend } from './memberRemoval'
import type { Expense } from './models'
import { createSharedActivity, isSharedActivity } from '../features/sharing/sharedActivity'

const friend = { id: 'sam', name: 'Sam', initials: 'S', color: '#abc' }
const group = { id: 'trip', name: 'Trip', emoji: '☀', memberIds: ['me', 'sam'] }
const expense: Expense = { id: 'dinner', groupId: 'trip', title: 'Dinner', amount: 20, payerId: 'me', splitMethod: 'exact', shares: { me: 20 }, createdAt: '2026-09-09T12:00:00Z' }
const activity = createSharedActivity(group, [CURRENT_USER, friend], [expense])

describe('safe friend removal', () => {
  it('removes only unreferenced friends without changing expenses or the snapshot contract', () => {
    const removed = removeActivityFriend(activity, 'sam')!
    expect(removed.group.memberIds).toEqual(['me'])
    expect(removed.friends).toEqual([])
    expect(removed.expenses).toBe(activity.expenses)
    expect(isSharedActivity(removed)).toBe(true)
    expect(activity.friends).toEqual([friend])
  })

  it.each([
    { ...expense, payerId: 'sam' },
    { ...expense, shares: { me: 10, sam: 10 } },
    { ...expense, shares: { me: 20, sam: 0 } },
    { ...expense, kind: 'settlement' as const, shares: { sam: 20 } },
    { ...expense, kind: 'settlement' as const, payerId: 'sam' },
  ])('preserves all payer, share, and settlement references', record => {
    expect(removeActivityFriend({ ...activity, expenses: [record] }, 'sam')).toBeNull()
  })

  it('protects the original participant and rejects missing or inconsistent members', () => {
    expect(removeActivityFriend(activity, 'me')).toBeNull()
    expect(removeActivityFriend(activity, 'missing')).toBeNull()
    expect(removeActivityFriend({ ...activity, friends: [] }, 'sam')).toBeNull()
  })

  it('scopes references to the current activity', () => {
    expect(memberExpenseReferences([{ ...expense, groupId: 'other', payerId: 'sam' }, expense], 'trip', 'sam')).toEqual([])
  })
})
