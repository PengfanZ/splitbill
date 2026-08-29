import { describe, expect, it } from 'vitest'
import { EXPENSE_CATEGORIES, expenseCategory, isExpenseCategory } from './expenseCategories'

describe('expense categories', () => {
  it('accepts every supported category and falls back for old or invalid expenses', () => {
    EXPENSE_CATEGORIES.forEach(category => expect(isExpenseCategory(category)).toBe(true))
    expect(isExpenseCategory('business')).toBe(false)
    expect(isExpenseCategory(null)).toBe(false)
    expect(expenseCategory({ category: 'transport' })).toBe('transport')
    expect(expenseCategory({})).toBe('uncategorized')
  })
})
