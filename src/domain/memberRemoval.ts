import type { ActivityGroup, Expense, Member } from './models'

type ActivityMembers = { group: ActivityGroup; friends: Member[]; expenses: Expense[] }

/** Keep every historical reference, including zero-value shares and settlements. */
export function memberExpenseReferences(expenses: Expense[], groupId: string, memberId: string) {
  return expenses.filter(expense => expense.groupId === groupId
    && (expense.payerId === memberId || Object.hasOwn(expense.shares, memberId)))
}

/** Returns null instead of ever leaving an expense with a dangling participant. */
export function removeActivityFriend<T extends ActivityMembers>(activity: T, memberId: string): T | null {
  if (memberId === 'me'
    || !activity.group.memberIds.includes(memberId)
    || !activity.friends.some(friend => friend.id === memberId)
    || memberExpenseReferences(activity.expenses, activity.group.id, memberId).length > 0) return null

  return {
    ...activity,
    group: { ...activity.group, memberIds: activity.group.memberIds.filter(id => id !== memberId) },
    friends: activity.friends.filter(friend => friend.id !== memberId),
  }
}
