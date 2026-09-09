import { describe, expect, it } from 'vitest'
import { CURRENT_USER } from './members'
import { activeActivityMembers, activeMemberCount, expenseEntryMembers, hasEligibleExpenseMembers, isInactiveMember, memberExpenseReferences, removeActivityFriend, restoreActivityFriend } from './memberRemoval'
import type { Expense } from './models'
import { createSharedActivity, isSharedActivity } from '../features/sharing/sharedActivity'

const friend = { id: 'sam', name: 'Sam', initials: 'S', color: '#abc' }
const maya = { ...friend, id: 'maya', name: 'Maya' }
const group = { id: 'trip', name: 'Trip', emoji: '☀', memberIds: ['me', 'sam'] }
const expense: Expense = { id: 'dinner', groupId: 'trip', title: 'Dinner', amount: 20, payerId: 'me', splitMethod: 'exact', shares: { me: 20 }, createdAt: '2026-09-09T12:00:00Z' }
const activity = createSharedActivity(group, [CURRENT_USER, friend], [expense])
const removed = removeActivityFriend(activity, 'sam')!

describe('inactive activity membership', () => {
  it('preserves identities and records in the backward-compatible snapshot contract', () => {
    expect(removed.group.memberIds).toBe(activity.group.memberIds)
    expect(removed.group.inactiveMemberIds).toEqual(['sam'])
    expect(removed.friends).toBe(activity.friends)
    expect(removed.expenses).toBe(activity.expenses)
    expect(isSharedActivity(removed)).toBe(true)
    expect(isInactiveMember(group, 'sam')).toBe(false)
    expect(isInactiveMember(removed.group, 'sam')).toBe(true)
    expect(activeMemberCount(group)).toBe(2)
    expect(activeMemberCount(removed.group)).toBe(1)
  })

  it.each([
    { ...expense, payerId: 'sam' },
    { ...expense, shares: { me: 10, sam: 10 } },
    { ...expense, shares: { me: 20, sam: 0 } },
    { ...expense, kind: 'settlement' as const, shares: { sam: 20 } },
    { ...expense, kind: 'settlement' as const, payerId: 'sam' },
  ])('allows removal without rewriting historical payer, share, or payment references', record => {
    const expenses = [record]
    expect(removeActivityFriend({ ...activity, expenses }, 'sam')?.expenses).toBe(expenses)
    expect(memberExpenseReferences(expenses, 'trip', 'sam')).toEqual(expenses)
  })

  it('protects the original participant and rejects invalid or already inactive members', () => {
    expect(removeActivityFriend(activity, 'me')).toBeNull()
    expect(removeActivityFriend(activity, 'missing')).toBeNull()
    expect(removeActivityFriend({ ...activity, friends: [] }, 'sam')).toBeNull()
    expect(removeActivityFriend(removed, 'sam')).toBeNull()
    expect(removeActivityFriend({ ...activity, group: { ...group, memberIds: ['me', 'sam', 'maya'], inactiveMemberIds: ['maya'] } }, 'sam')?.group.inactiveMemberIds).toEqual(['maya', 'sam'])
  })

  it('restores the same identity without modifying history or other inactive friends', () => {
    expect(restoreActivityFriend(activity, 'sam')).toBeNull()
    expect(restoreActivityFriend(removed, 'sam')).toEqual({ ...activity, group: { ...group, inactiveMemberIds: [] } })
    expect(restoreActivityFriend({ ...removed, group: { ...removed.group, inactiveMemberIds: ['sam', 'maya'] } }, 'sam')?.group.inactiveMemberIds).toEqual(['maya'])
  })

  it('selects active people for new bills and original inactive participants for edits', () => {
    const members = [CURRENT_USER, friend, maya]
    expect(activeActivityMembers(removed.group, members)).toEqual([CURRENT_USER])
    expect(expenseEntryMembers(removed.group, members)).toEqual([CURRENT_USER])
    expect(expenseEntryMembers(removed.group, members, expense)).toEqual([CURRENT_USER])
    expect(expenseEntryMembers(removed.group, members, { ...expense, payerId: 'sam' })).toEqual([CURRENT_USER, friend])
    expect(expenseEntryMembers(removed.group, members, { ...expense, shares: { me: 20, sam: 0 } })).toEqual([CURRENT_USER, friend])
  })

  it('rejects new inactive references but allows original bill edits and settlements', () => {
    expect(hasEligibleExpenseMembers(removed.group, expense)).toBe(true)
    expect(hasEligibleExpenseMembers(removed.group, { ...expense, payerId: 'sam' })).toBe(false)
    expect(hasEligibleExpenseMembers(removed.group, { ...expense, shares: { me: 20, sam: 0 } })).toBe(false)
    expect(hasEligibleExpenseMembers(removed.group, { ...expense, payerId: 'missing' })).toBe(false)
    expect(hasEligibleExpenseMembers(removed.group, { ...expense, payerId: 'sam' }, expense)).toBe(false)
    expect(hasEligibleExpenseMembers(removed.group, { ...expense, payerId: 'sam' }, { ...expense, payerId: 'sam' })).toBe(true)
    expect(hasEligibleExpenseMembers(removed.group, { ...expense, shares: { sam: 20 } }, { ...expense, shares: { sam: 20 } })).toBe(true)
    expect(hasEligibleExpenseMembers(removed.group, { ...expense, kind: 'settlement', payerId: 'sam' })).toBe(true)
  })

  it('scopes references to the current activity', () => {
    expect(memberExpenseReferences([{ ...expense, groupId: 'other', payerId: 'sam' }, expense], 'trip', 'sam')).toEqual([])
  })
})
