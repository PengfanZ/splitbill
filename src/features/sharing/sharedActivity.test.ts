import { describe, expect, it } from 'vitest'
import { EMPTY_STATE } from '../../data/storage'
import { CURRENT_USER } from '../../domain/members'
import type { ActivityGroup, Expense, Member } from '../../domain/models'
import {
  createSharedActivity,
  getSharedActivitySender,
  isSharedActivity,
  saveSharedActivityCopy,
} from './sharedActivity'

const maya: Member = { id: 'maya', name: 'Maya', initials: 'M', color: '#abc' }
const group: ActivityGroup = { id: 'trip', name: 'Trip', emoji: '✦', memberIds: ['me', 'maya'] }
const expense: Expense = {
  id: 'dinner',
  groupId: group.id,
  title: 'Dinner',
  amount: 30,
  payerId: 'me',
  splitMethod: 'equal',
  shares: { me: 15, maya: 15 },
  createdAt: '2026-07-29T01:00:00.000Z',
}
const settlement: Expense = {
  id: 'settlement',
  groupId: group.id,
  title: 'Settlement payment',
  amount: 5,
  payerId: maya.id,
  splitMethod: 'exact',
  shares: { me: 5 },
  createdAt: '2026-07-29T02:00:00.000Z',
  kind: 'settlement',
}

describe('shared activity domain model', () => {
  it('creates and validates the canonical Live activity payload', () => {
    const activity = createSharedActivity(group, [CURRENT_USER, maya], [expense])

    expect(activity).toEqual({
      version: 2,
      sender: CURRENT_USER,
      group,
      friends: [maya],
      expenses: [expense],
    })
    expect(getSharedActivitySender(activity)).toBe(CURRENT_USER)
    expect(isSharedActivity(activity)).toBe(true)
    expect(isSharedActivity({ ...activity, version: 3 })).toBe(false)
    expect(createSharedActivity(group, [maya], [expense]).sender).toBe(CURRENT_USER)
  })

  it('saves an isolated local copy with every participant reference remapped', () => {
    const activity = createSharedActivity(group, [CURRENT_USER, maya], [expense])
    const result = saveSharedActivityCopy(EMPTY_STATE, activity, 'me')
    const copiedGroup = result.groups[0]
    const copiedFriend = result.friends[0]
    const copiedExpense = result.expenses[0]

    expect(copiedGroup.id).not.toBe(group.id)
    expect(copiedFriend).toMatchObject({ name: maya.name, initials: maya.initials, color: maya.color })
    expect(copiedFriend.id).not.toBe(maya.id)
    expect(copiedGroup.memberIds).toEqual(['me', copiedFriend.id])
    expect(copiedExpense).toMatchObject({ groupId: copiedGroup.id, payerId: 'me' })
    expect(copiedExpense.id).not.toBe(expense.id)
    expect(copiedExpense.shares).toEqual({ me: 15, [copiedFriend.id]: 15 })
    expect(result.selectedGroupId).toBe(copiedGroup.id)

    const withExisting = saveSharedActivityCopy(
      { ...EMPTY_STATE, groups: [group], friends: [maya], expenses: [expense] },
      activity,
      'me',
    )
    expect(withExisting.groups).toHaveLength(2)
    expect(withExisting.friends).toHaveLength(2)
    expect(withExisting.expenses.at(-1)).toBe(expense)
  })

  it('can make a selected friend the local current user', () => {
    const sender = { ...CURRENT_USER, name: 'Alex', initials: 'A' }
    const activity = createSharedActivity(group, [sender, maya], [expense, settlement])
    const result = saveSharedActivityCopy(EMPTY_STATE, activity, maya.id)
    const copiedSender = result.friends.find(friend => friend.name === sender.name)

    expect(result.friends.some(friend => friend.name === maya.name)).toBe(false)
    expect(copiedSender).toBeDefined()
    expect(result.groups[0].memberIds).toEqual([copiedSender?.id, 'me'])
    expect(result.expenses[0]).toMatchObject({
      payerId: copiedSender?.id,
      shares: { [copiedSender!.id]: 15, me: 15 },
    })
    expect(result.expenses[1]).toMatchObject({
      kind: 'settlement',
      payerId: 'me',
      shares: { [copiedSender!.id]: 5 },
    })
  })

  it('rejects an invalid viewer and inconsistent participant references', () => {
    const activity = createSharedActivity(group, [CURRENT_USER, maya], [expense])
    const unknownMember = { ...activity, group: { ...group, memberIds: ['me', 'unknown'] } }
    const unknownPayer = { ...activity, expenses: [{ ...expense, payerId: 'unknown' }] }
    const unknownShare = { ...activity, expenses: [{ ...expense, shares: { me: 15, unknown: 15 } }] }

    expect(() => saveSharedActivityCopy(EMPTY_STATE, activity, 'missing')).toThrow('not part of this activity')
    expect(() => saveSharedActivityCopy(EMPTY_STATE, unknownMember, 'me')).toThrow('unknown participant')
    expect(() => saveSharedActivityCopy(EMPTY_STATE, unknownPayer, 'me')).toThrow('unknown participant')
    expect(() => saveSharedActivityCopy(EMPTY_STATE, unknownShare, 'me')).toThrow('unknown participant')
  })
})
