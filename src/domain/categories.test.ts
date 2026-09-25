import { describe, expect, it } from 'vitest'
import { activityCategories, CATEGORY_COLORS, categoryLabel, categoryNameError, categorySummary, changeCategories, DEFAULT_CATEGORIES, expenseCategory, GENERAL_CATEGORY, suggestCategoryId } from './categories'
import type { ActivityGroup, Expense } from './models'
import { calculateMemberBalance } from './expenses'
import { parseState } from '../data/storage'
import { createSharedActivity, isSharedActivity, saveSharedActivityCopy } from '../features/sharing/sharedActivity'
import { CURRENT_USER } from './members'

const group: ActivityGroup = { id: 'trip', name: 'Trip', emoji: '✦', memberIds: ['me'] }
const expense: Expense = { id: 'dinner', groupId: 'trip', title: 'Dinner', amount: 12.34, payerId: 'me', splitMethod: 'equal', shares: { me: 12.34 }, createdAt: '2026-09-22T12:00:00.000Z' }
const coffee = { id: 'coffee', name: 'Coffee', color: CATEGORY_COLORS[0] }

describe('expense categories', () => {
  it('preserves legacy exact splits, removed members, repayments, currencies and unrelated activities', () => {
    const oldGroup = { ...group, memberIds: ['me', 'friend'], inactiveMemberIds: ['friend'], currency: 'CNY' as const }
    const bills: Expense[] = [
      { ...expense, splitMethod: 'exact', payerId: 'friend', shares: { me: 5.01, friend: 7.33 } },
      { ...expense, id: 'repayment', kind: 'settlement', amount: 2, splitMethod: 'exact', payerId: 'me', shares: { friend: 2 } },
      { ...expense, id: 'elsewhere', groupId: 'other' },
    ]
    const state = { groups: [oldGroup, { ...group, id: 'other' }], expenses: bills, friends: [{ id: 'friend', name: '小陈', initials: '陈', color: '#abc' }], selectedGroupId: oldGroup.id }
    const restored = parseState(JSON.stringify(state))
    expect(restored).toEqual(state)
    const before = ['me', 'friend'].map(id => calculateMemberBalance(id, bills))
    const categorized = changeCategories(oldGroup, bills, { kind: 'save', category: coffee })!
    expect(categorized.expenses).toEqual(bills)
    const assigned = [{ ...bills[0], categoryId: coffee.id }, ...bills.slice(1)]
    const cleared = changeCategories(categorized.group, assigned, { kind: 'delete', id: coffee.id })!
    expect(cleared.group).toMatchObject(oldGroup)
    expect(cleared.expenses).toEqual([{ ...bills[0], categoryId: null }, ...bills.slice(1)])
    expect(['me', 'friend'].map(id => calculateMemberBalance(id, cleared.expenses))).toEqual(before)
    expect(categorySummary(cleared.group, cleared.expenses).map(row => row.cents)).toEqual([1234])
    const shared = createSharedActivity(oldGroup, [CURRENT_USER, ...state.friends], bills.filter(bill => bill.groupId === group.id))
    expect(isSharedActivity(shared)).toBe(true)
    expect(shared.group.inactiveMemberIds).toEqual(['friend'])
    expect(shared.expenses).toEqual(bills.slice(0, 2))
  })
  it('keeps legacy records in General and localizes only built-in labels', () => {
    expect(activityCategories(group)).toBe(DEFAULT_CATEGORIES)
    expect(activityCategories({ categories: [] })).toEqual([])
    expect(expenseCategory(group, expense)).toBe(GENERAL_CATEGORY)
    expect(expenseCategory(group, { categoryId: 'missing' })).toBe(GENERAL_CATEGORY)
    expect(categoryLabel(GENERAL_CATEGORY, 'en')).toBe('General')
    expect(categoryLabel(GENERAL_CATEGORY, 'zh-CN')).toBe('通用')
    expect(categoryLabel(DEFAULT_CATEGORIES[0], 'zh-CN')).toBe('餐饮')
    expect(categoryLabel(DEFAULT_CATEGORIES[0], 'en')).toBe('Food & drinks')
    expect(categoryLabel(coffee, 'zh-CN')).toBe('Coffee')
  })
  it('validates trimmed, unique, reserved, and bounded names', () => {
    expect(categoryNameError(' ', [])).toBe('empty')
    expect(categoryNameError('x'.repeat(33), [])).toBe('long')
    for (const name of ['General', '通用', 'food & drinks', '餐饮']) expect(categoryNameError(name, DEFAULT_CATEGORIES)).toBe('duplicate')
    expect(categoryNameError('Food & drinks', DEFAULT_CATEGORIES, 'food')).toBeNull()
    expect(categoryNameError('咖啡', [])).toBeNull()
  })
  it('aggregates only this activity spending in integer cents, excluding settlements', () => {
    const expenses = [expense, { ...expense, id: '2', categoryId: 'food' }, { ...expense, id: '3', categoryId: 'food' }, { ...expense, kind: 'settlement' as const }, { ...expense, groupId: 'other' }]
    expect(categorySummary(group, expenses).map(row => [row.category.id, row.cents, row.count])).toEqual([['food', 2468, 2], ['', 1234, 1]])
    expect(categorySummary(group, [])).toEqual([])
    expect(categorySummary(group, [expense, { ...expense, categoryId: 'food' }]).map(row => row.category.id)).toEqual(['', 'food'])
  })
  it('creates, renames and deletes atomically without changing money or other activities', () => {
    const created = changeCategories(group, [expense], { kind: 'save', category: coffee })!
    expect(created.group.categories).toContainEqual(coffee)
    const renamed = changeCategories(created.group, created.expenses, { kind: 'save', category: { ...coffee, name: ' Café ' } })!
    expect(renamed.group.categories?.at(-1)?.name).toBe('Café')
    const categorized = [{ ...expense, categoryId: coffee.id }, { ...expense, groupId: 'other', categoryId: coffee.id }]
    const removed = changeCategories(renamed.group, categorized, { kind: 'delete', id: coffee.id })!
    expect(removed.expenses[0]).toEqual({ ...expense, categoryId: null })
    expect(removed.expenses[1]).toBe(categorized[1])
    expect(categorized[0].categoryId).toBe(coffee.id)
    expect(calculateMemberBalance('me', removed.expenses)).toBe(calculateMemberBalance('me', categorized))
  })
  it('rejects invalid changes and protects the permanent default', () => {
    expect(changeCategories(group, [], { kind: 'delete', id: '' })).toBeNull()
    expect(changeCategories(group, [], { kind: 'delete', id: 'absent' })).toBeNull()
    for (const category of [{ ...coffee, id: '' }, { ...coffee, id: 'x'.repeat(121) }, { ...coffee, color: 'red' }, { ...coffee, name: 'General' }]) expect(changeCategories(group, [], { kind: 'save', category })).toBeNull()
    const full = { ...group, categories: Array.from({ length: 40 }, (_, index) => ({ ...coffee, id: `${index}`, name: `Category ${index}` })) }
    expect(changeCategories(full, [], { kind: 'save', category: coffee })).toBeNull()
    expect(changeCategories(full, [], { kind: 'save', category: { ...coffee, id: '0' } })).not.toBeNull()
  })
  it('round-trips local, live and independent copies with stable category IDs', () => {
    const categorizedGroup = { ...group, categories: [coffee] }
    const expenses = [{ ...expense, categoryId: coffee.id }]
    const state = { groups: [categorizedGroup], expenses, friends: [], selectedGroupId: group.id }
    expect(parseState(JSON.stringify(state))).toEqual(state)
    const shared = createSharedActivity(categorizedGroup, [CURRENT_USER], expenses)
    expect(isSharedActivity(shared)).toBe(true)
    const copied = saveSharedActivityCopy({ groups: [], friends: [], expenses: [], selectedGroupId: null }, shared, 'me')
    expect(copied.groups[0].categories).toEqual([coffee])
    expect(copied.expenses[0].categoryId).toBe(coffee.id)
    for (const categories of [[coffee, coffee], [{ ...coffee, name: 'General' }], [{ ...coffee, color: 'red' }], []]) expect(isSharedActivity({ ...shared, group: { ...categorizedGroup, categories } })).toBe(false)
    expect(isSharedActivity({ ...shared, expenses: [{ ...expenses[0], categoryId: 'missing' }] })).toBe(false)
  })

  it('suggests built-in categories from description keywords in English and Chinese', () => {
    expect(suggestCategoryId('Dinner at Cervejaria Ramiro', DEFAULT_CATEGORIES)).toBe('food')
    expect(suggestCategoryId('Airbnb – 4 nights', DEFAULT_CATEGORIES)).toBe('stay')
    expect(suggestCategoryId('Tram tickets', DEFAULT_CATEGORIES)).toBe('transport')
    expect(suggestCategoryId('Hotel breakfast', DEFAULT_CATEGORIES)).toBe('stay')
    expect(suggestCategoryId('MUSEUM', DEFAULT_CATEGORIES)).toBe('activities')
    expect(suggestCategoryId('周五晚餐', DEFAULT_CATEGORIES)).toBe('food')
    expect(suggestCategoryId('机场打车', DEFAULT_CATEGORIES)).toBe('transport')
    expect(suggestCategoryId('Sonder barbecue', DEFAULT_CATEGORIES)).toBeNull()
    expect(suggestCategoryId('Pastéis de nata', DEFAULT_CATEGORIES)).toBeNull()
    expect(suggestCategoryId('', DEFAULT_CATEGORIES)).toBeNull()
  })

  it('suggests only built-ins the activity still has under their original name', () => {
    const withoutFood = DEFAULT_CATEGORIES.filter(category => category.id !== 'food')
    const renamedFood = [{ ...DEFAULT_CATEGORIES[0], name: 'Gifts' }, ...DEFAULT_CATEGORIES.slice(1)]
    expect(suggestCategoryId('Lunch', withoutFood)).toBeNull()
    expect(suggestCategoryId('Lunch', renamedFood)).toBeNull()
    expect(suggestCategoryId('Lunch', [coffee])).toBeNull()
    expect(suggestCategoryId('Taxi', renamedFood)).toBe('transport')
  })
})
