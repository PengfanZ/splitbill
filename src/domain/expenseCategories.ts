import type { Expense } from './models'

export const EXPENSE_CATEGORIES = [
  'food',
  'transport',
  'accommodation',
  'entertainment',
  'shopping',
  'other',
  'uncategorized',
] as const

export type ExpenseCategory = typeof EXPENSE_CATEGORIES[number]

export function isExpenseCategory(value: unknown): value is ExpenseCategory {
  return typeof value === 'string' && EXPENSE_CATEGORIES.some(category => category === value)
}

export function expenseCategory(expense: Pick<Expense, 'category'>): ExpenseCategory {
  return isExpenseCategory(expense.category) ? expense.category : 'uncategorized'
}
