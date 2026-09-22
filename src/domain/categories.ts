import type { ActivityGroup, Expense, ExpenseCategory } from './models'

export const CATEGORY_COLORS = ['#719d86', '#e48e7e', '#d1aa55', '#80a4cd', '#a78ab8', '#8c8881'] as const
export const MAX_CATEGORIES = 40
export const GENERAL_CATEGORY: ExpenseCategory = { id: '', name: 'General', color: '#8c8881' }
export const DEFAULT_CATEGORIES: ExpenseCategory[] = [
  { id: 'food', name: 'Food & drinks', color: '#e48e7e' },
  { id: 'stay', name: 'Stay', color: '#719d86' },
  { id: 'transport', name: 'Transport', color: '#d1aa55' },
  { id: 'activities', name: 'Activities', color: '#80a4cd' },
]
const chineseNames: Record<string, string> = { food: '餐饮', stay: '住宿', transport: '交通', activities: '娱乐活动' }
export const activityCategories = (group: Pick<ActivityGroup, 'categories'>) => group.categories ?? DEFAULT_CATEGORIES
export function categoryLabel(category: ExpenseCategory, locale: string) {
  if (!category.id) return locale === 'zh-CN' ? '通用' : 'General'
  const original = DEFAULT_CATEGORIES.find(item => item.id === category.id && item.name === category.name)
  return locale === 'zh-CN' && original ? chineseNames[original.id] : category.name
}
export function expenseCategory(group: Pick<ActivityGroup, 'categories'>, expense: Pick<Expense, 'categoryId'>) {
  return activityCategories(group).find(category => category.id === expense.categoryId) ?? GENERAL_CATEGORY
}
export function categoryNameError(name: string, categories: ExpenseCategory[], editingId?: string): 'empty' | 'long' | 'duplicate' | null {
  const normalized = name.trim().toLowerCase()
  if (!normalized) return 'empty'
  if (name.trim().length > 32) return 'long'
  if (['general', '通用'].includes(normalized) || categories.some(category => category.id !== editingId && [category.name.toLowerCase(), categoryLabel(category, 'zh-CN').toLowerCase()].includes(normalized))) return 'duplicate'
  return null
}
export function categorySummary(group: ActivityGroup, expenses: Expense[]) {
  const entries = new Map<string, { category: ExpenseCategory; cents: number; count: number }>()
  for (const expense of expenses) {
    if (expense.groupId !== group.id || expense.kind === 'settlement') continue
    const category = expenseCategory(group, expense)
    const entry = entries.get(category.id) ?? { category, cents: 0, count: 0 }
    entry.cents += Math.round(expense.amount * 100)
    entry.count++
    entries.set(category.id, entry)
  }
  return [...entries.values()].sort((a, b) => b.cents - a.cents || a.category.id.localeCompare(b.category.id))
}

export type CategoryChange = { kind: 'save'; category: ExpenseCategory } | { kind: 'delete'; id: string }
/** Pure, atomic category + expense update, shared by local and live activities. */
export function changeCategories(group: ActivityGroup, expenses: Expense[], change: CategoryChange) {
  const categories = activityCategories(group)
  if (change.kind === 'delete') {
    if (!change.id || !categories.some(category => category.id === change.id)) return null
    return {
      group: { ...group, categories: categories.filter(category => category.id !== change.id) },
      expenses: expenses.map(expense => expense.groupId === group.id && expense.categoryId === change.id ? { ...expense, categoryId: null } : expense),
    }
  }
  const category = { ...change.category, name: change.category.name.trim() }
  const exists = categories.some(item => item.id === category.id)
  if (!category.id || category.id.length > 120 || !CATEGORY_COLORS.some(color => color === category.color)
    || categoryNameError(category.name, categories, category.id) || (!exists && categories.length >= MAX_CATEGORIES)) return null
  return {
    group: { ...group, categories: exists ? categories.map(item => item.id === category.id ? category : item) : [...categories, category] },
    expenses,
  }
}
