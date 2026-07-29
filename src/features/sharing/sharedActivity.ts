import { CURRENT_USER, makeId } from '../../domain/members'
import type { ActivityGroup, Expense, Member, PersistedState } from '../../domain/models'
import {
  MAX_ACTIVITY_AMOUNT,
  MAX_ACTIVITY_EXPENSES,
  MAX_ACTIVITY_FRIENDS,
  MAX_ACTIVITY_SNAPSHOT_BYTES,
  sharedActivitySchema,
  type SharedActivity,
} from './sharedActivitySchema'

export {
  MAX_ACTIVITY_AMOUNT,
  MAX_ACTIVITY_EXPENSES,
  MAX_ACTIVITY_FRIENDS,
  MAX_ACTIVITY_SNAPSHOT_BYTES,
  type SharedActivity,
}

export function getSharedActivitySender(activity: SharedActivity) {
  return activity.sender
}

function getRemappedMemberId(memberIdMap: Map<string, string>, memberId: string) {
  const remappedMemberId = memberIdMap.get(memberId)
  if (!remappedMemberId) throw new RangeError('Activity references an unknown participant')
  return remappedMemberId
}

export function createSharedActivity(group: ActivityGroup, members: Member[], expenses: Expense[]): SharedActivity {
  return {
    version: 2,
    sender: members.find(member => member.id === 'me') ?? CURRENT_USER,
    group,
    friends: members.filter(member => member.id !== 'me'),
    expenses,
  }
}

export function isSharedActivity(value: unknown): value is SharedActivity {
  return sharedActivitySchema.safeParse(value).success
}

export function saveSharedActivityCopy(current: PersistedState, activity: SharedActivity, viewerId: string): PersistedState {
  if (!activity.group.memberIds.includes(viewerId)) throw new RangeError('Selected participant is not part of this activity')
  const groupId = makeId('group')
  const memberIdMap = new Map<string, string>([[viewerId, 'me']])
  const friends = [getSharedActivitySender(activity), ...activity.friends].filter(member => member.id !== viewerId).map(friend => {
    const id = makeId('friend')
    memberIdMap.set(friend.id, id)
    return { ...friend, id }
  })
  const group: ActivityGroup = {
    ...activity.group,
    id: groupId,
    memberIds: activity.group.memberIds.map(memberId => getRemappedMemberId(memberIdMap, memberId)),
  }
  const expenses = activity.expenses.map(expense => ({
    ...expense,
    id: makeId('expense'),
    groupId,
    payerId: getRemappedMemberId(memberIdMap, expense.payerId),
    shares: Object.fromEntries(
      Object.entries(expense.shares).map(([memberId, share]) => [getRemappedMemberId(memberIdMap, memberId), share]),
    ),
  }))

  return {
    groups: [...current.groups, group],
    friends: [...current.friends, ...friends],
    expenses: [...expenses, ...current.expenses],
    selectedGroupId: groupId,
  }
}
