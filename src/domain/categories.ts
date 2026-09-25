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
// Checked in this order, so "Hotel breakfast" is a stay and "Tram tickets" is transport.
const CATEGORY_KEYWORDS: ReadonlyArray<{ id: string; words: ReadonlySet<string>; chinese: readonly string[] }> = [
  {
    id: 'stay',
    words: new Set(['hotel', 'hotels', 'hostel', 'airbnb', 'motel', 'lodging', 'accommodation', 'apartment', 'cabin', 'resort', 'rent']),
    chinese: ['酒店', '住宿', '民宿', '宾馆', '旅馆', '房租'],
  },
  {
    id: 'transport',
    words: new Set(['taxi', 'uber', 'lyft', 'cab', 'bus', 'train', 'tram', 'metro', 'subway', 'flight', 'flights', 'airfare', 'ferry', 'fuel', 'petrol', 'parking', 'toll', 'tolls']),
    chinese: ['打车', '出租车', '滴滴', '地铁', '公交', '火车', '高铁', '机票', '航班', '加油', '停车', '过路费'],
  },
  {
    id: 'activities',
    words: new Set(['museum', 'tour', 'concert', 'movie', 'movies', 'cinema', 'ticket', 'tickets', 'zoo', 'gallery', 'ski', 'spa', 'bowling', 'karaoke']),
    chinese: ['门票', '电影', '博物馆', '演唱会', '景区', '滑雪', '按摩'],
  },
  {
    id: 'food',
    words: new Set(['dinner', 'lunch', 'breakfast', 'brunch', 'meal', 'restaurant', 'cafe', 'café', 'coffee', 'bar', 'drinks', 'beer', 'wine', 'pizza', 'sushi', 'groceries', 'grocery', 'supermarket', 'snacks', 'dessert', 'bakery', 'takeaway', 'takeout']),
    chinese: ['餐', '饭', '咖啡', '奶茶', '酒吧', '超市', '买菜', '外卖', '火锅', '烧烤', '零食'],
  },
]

/** Suggests a built-in category from an expense description, only while that built-in is still in the activity unchanged. */
export function suggestCategoryId(title: string, categories: ExpenseCategory[]): string | null {
  const text = title.toLowerCase()
  const words = text.split(/[^\p{L}\p{N}]+/u)
  const match = CATEGORY_KEYWORDS.find(({ words: keywords, chinese }) => words.some(word => keywords.has(word)) || chinese.some(term => text.includes(term)))
  if (!match) return null
  const builtIn = DEFAULT_CATEGORIES.find(category => category.id === match.id)!
  return categories.some(category => category.id === builtIn.id && category.name === builtIn.name) ? builtIn.id : null
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
