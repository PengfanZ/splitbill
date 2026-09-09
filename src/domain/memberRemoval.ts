import type { ActivityGroup, Expense, Member } from './models'

type ActivityMembers = { group: ActivityGroup; friends: Member[]; expenses: Expense[] }

/** Keep every historical reference, including zero-value shares and settlements. */
export function memberExpenseReferences(expenses: Expense[], groupId: string, memberId: string) {
  return expenses.filter(expense => expense.groupId === groupId
    && (expense.payerId === memberId || Object.hasOwn(expense.shares, memberId)))
}

export function isInactiveMember(group: ActivityGroup, memberId: string) {
  return group.inactiveMemberIds?.includes(memberId) ?? false
}

export function activeActivityMembers(group: ActivityGroup, members: Member[]) {
  return members.filter(member => group.memberIds.includes(member.id) && !isInactiveMember(group, member.id))
}

export function activeMemberCount(group: ActivityGroup) {
  return group.memberIds.filter(id => !isInactiveMember(group, id)).length
}

/** New bills use active members; edits also retain the bill's original participants. */
export function expenseEntryMembers(group: ActivityGroup, members: Member[], expense?: Expense) {
  return members.filter(member => group.memberIds.includes(member.id) && (!isInactiveMember(group, member.id)
    || Boolean(expense && (expense.payerId === member.id || Object.hasOwn(expense.shares, member.id)))))
}

export function hasEligibleExpenseMembers(group: ActivityGroup, expense: Expense, previous?: Expense) {
  const eligible = (id: string) => group.memberIds.includes(id)
    && (expense.kind === 'settlement' || !isInactiveMember(group, id)
      || Boolean(previous && (previous.payerId === id || Object.hasOwn(previous.shares, id))))
  return eligible(expense.payerId) && Object.keys(expense.shares).every(eligible)
}

/** Soft removal preserves all member IDs, balances, expenses, and settlements. */
export function removeActivityFriend<T extends ActivityMembers>(activity: T, memberId: string): T | null {
  if (memberId === 'me'
    || !activity.group.memberIds.includes(memberId)
    || !activity.friends.some(friend => friend.id === memberId)
    || isInactiveMember(activity.group, memberId)) return null

  return {
    ...activity,
    group: { ...activity.group, inactiveMemberIds: [...(activity.group.inactiveMemberIds ?? []), memberId] },
  }
}

export function restoreActivityFriend<T extends ActivityMembers>(activity: T, memberId: string): T | null {
  if (!isInactiveMember(activity.group, memberId)) return null
  return { ...activity, group: { ...activity.group, inactiveMemberIds: activity.group.inactiveMemberIds!.filter(id => id !== memberId) } }
}
