import type { PersistedState, Expense, Member } from '../../domain/models'
import { ACTIVITY_EMOJIS, FRIEND_COLORS, initialsFor, makeId } from '../../domain/members'

export function createActivityFriends(names: string[], colorOffset: number): Member[] {
  return names.map((name, index) => ({
    id: makeId('friend'),
    name,
    initials: initialsFor(name),
    color: FRIEND_COLORS[(colorOffset + index) % FRIEND_COLORS.length],
  }))
}

export function createLocalActivity(state: PersistedState, name: string, friendNames: string[]): PersistedState {
  const friends = createActivityFriends(friendNames, state.friends.length)
  const group = {
    id: makeId('group'),
    name,
    emoji: ACTIVITY_EMOJIS[state.groups.length % ACTIVITY_EMOJIS.length],
    memberIds: ['me', ...friends.map(friend => friend.id)],
  }

  return {
    ...state,
    groups: [...state.groups, group],
    friends: [...state.friends, ...friends],
    selectedGroupId: group.id,
  }
}

export function addLocalFriends(state: PersistedState, groupId: string, names: string[]): PersistedState {
  if (!state.groups.some(group => group.id === groupId)) return state
  const friends = createActivityFriends(names, state.friends.length)
  return {
    ...state,
    friends: [...state.friends, ...friends],
    groups: state.groups.map(group => group.id === groupId
      ? { ...group, memberIds: [...group.memberIds, ...friends.map(friend => friend.id)] }
      : group),
  }
}

export function addLocalExpense(state: PersistedState, expense: Expense): PersistedState {
  return { ...state, expenses: [expense, ...state.expenses] }
}

export function updateLocalExpense(state: PersistedState, expense: Expense): PersistedState {
  return {
    ...state,
    expenses: state.expenses.map(item => item.id === expense.id ? expense : item),
  }
}

export function deleteLocalExpense(state: PersistedState, expenseId: string): PersistedState {
  return { ...state, expenses: state.expenses.filter(expense => expense.id !== expenseId) }
}

export function deleteLocalActivity(state: PersistedState, groupId: string): PersistedState {
  const selectedGroup = state.groups.find(group => group.id === state.selectedGroupId) ?? state.groups[0] ?? null
  const groups = state.groups.filter(group => group.id !== groupId)
  const remainingMemberIds = new Set(groups.flatMap(group => group.memberIds))
  return {
    ...state,
    groups,
    friends: state.friends.filter(friend => remainingMemberIds.has(friend.id)),
    expenses: state.expenses.filter(expense => expense.groupId !== groupId),
    selectedGroupId: selectedGroup?.id === groupId ? groups[0]?.id ?? null : state.selectedGroupId,
  }
}
