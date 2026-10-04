import type { Expense } from '../domain/models'
import type { SharedActivity } from '../features/sharing/sharedActivity'

export const TOKYO_CODE = 'A1B2C3D4E5'
export const TOKYO_TOKEN = 'a'.repeat(64)

export function tokyoExpense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: 'expense-suica',
    groupId: 'group-tokyo',
    title: 'Suica top-up',
    amount: 5000,
    payerId: 'me',
    splitMethod: 'equal',
    shares: { me: 1666.67, 'friend-leo': 1666.67, 'friend-sam': 1666.66 },
    createdAt: '2026-09-20T03:00:00.000Z',
    categoryId: 'transport',
    ...overrides,
  }
}

/** Mia created Tokyo trip with Leo and Sam; Ana was removed after paying for one dinner. */
export function tokyoActivity(expenses: Expense[] = [tokyoExpense()]): SharedActivity {
  return {
    version: 2,
    sender: { id: 'me', name: 'Mia', initials: 'M', color: '#ead1b9' },
    group: {
      id: 'group-tokyo',
      name: 'Tokyo trip',
      emoji: '✈',
      memberIds: ['me', 'friend-leo', 'friend-sam', 'friend-ana'],
      inactiveMemberIds: ['friend-ana'],
      currency: 'JPY',
    },
    friends: [
      { id: 'friend-leo', name: 'Leo', initials: 'L', color: '#d6e8dc' },
      { id: 'friend-sam', name: 'Sam', initials: 'S', color: '#f6d5bd' },
      { id: 'friend-ana', name: 'Ana', initials: 'A', color: '#d8dde8' },
    ],
    expenses,
  }
}
