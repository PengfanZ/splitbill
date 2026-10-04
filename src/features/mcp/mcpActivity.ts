import { DEFAULT_CATEGORIES, GENERAL_CATEGORY } from '../../domain/categories'
import { activityCurrency, type CurrencyCode } from '../../domain/currency'
import {
  calculateMemberBalance,
  calculateSettlements,
  createEqualShares,
  isSettlementPayment,
  spendingExpenses,
} from '../../domain/expenses'
import { isInactiveMember } from '../../domain/memberRemoval'
import { ACTIVITY_EMOJIS, CURRENT_USER, initialsFor, parseMemberNames } from '../../domain/members'
import type { Expense, Member } from '../../domain/models'
import { createActivityFriends } from '../activity/activityState'
import { isSharedActivity, MAX_ACTIVITY_AMOUNT, type SharedActivity } from '../sharing/sharedActivity'

/** A problem the agent should relay or fix, as opposed to an unexpected failure. */
export class McpToolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'McpToolError'
  }
}

export type SplitInput =
  | { method: 'equal'; participants?: string[] }
  | { method: 'exact'; shares: Record<string, number> }

export type ExpenseInput = {
  title: string
  amount: number
  payer: string
  split: SplitInput
  category?: string
  date?: string
}

export type CreateActivityInput = {
  name: string
  creatorName: string
  memberNames: string[]
  currency: CurrencyCode
  emoji?: string
}

const toCents = (amount: number) => Math.round(amount * 100)
const fromCents = (cents: number) => cents / 100
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

export function activityMembers(activity: SharedActivity): Member[] {
  return [activity.sender, ...activity.friends]
}

function memberName(activity: SharedActivity, memberId: string) {
  return activityMembers(activity).find(member => member.id === memberId)?.name ?? memberId
}

export function resolveMember(activity: SharedActivity, reference: string): Member {
  const members = activityMembers(activity)
  const trimmed = reference.trim()
  const key = trimmed.toLocaleLowerCase()
  const matches = members.some(member => member.id === trimmed)
    ? members.filter(member => member.id === trimmed)
    : members.filter(member => member.name.trim().toLocaleLowerCase() === key)
  const active = matches.filter(member => !isInactiveMember(activity.group, member.id))
  const activeNames = members.filter(member => !isInactiveMember(activity.group, member.id)).map(member => member.name)
  if (active.length === 1) return active[0]
  if (active.length > 1) {
    throw new McpToolError(`"${reference}" matches ${active.length} people in ${activity.group.name}. Use a member id instead: ${active.map(member => `${member.name} (${member.id})`).join(', ')}.`)
  }
  if (matches.length) throw new McpToolError(`${matches[0].name} was removed from ${activity.group.name} and can't be part of new expenses.`)
  throw new McpToolError(`No one called "${reference}" is in ${activity.group.name}. Members: ${activeNames.join(', ')}.`)
}

function resolveCategoryId(activity: SharedActivity, reference: string | undefined) {
  if (reference === undefined || !reference.trim()) return null
  const key = reference.trim().toLocaleLowerCase()
  if (key === GENERAL_CATEGORY.name.toLocaleLowerCase()) return null
  const categories = activity.group.categories ?? DEFAULT_CATEGORIES
  const category = categories.find(item => item.id === reference.trim() || item.name.toLocaleLowerCase() === key)
  if (!category) {
    throw new McpToolError(`${activity.group.name} has no "${reference}" category. Categories: ${[GENERAL_CATEGORY.name, ...categories.map(item => item.name)].join(', ')}.`)
  }
  return category.id
}

function expenseTimestamp(date: string | undefined, now: Date) {
  if (date === undefined) return now.toISOString()
  const trimmed = date.trim()
  const timestamp = DATE_ONLY.test(trimmed) ? `${trimmed}T12:00:00.000Z` : trimmed
  const parsed = new Date(timestamp)
  if (Number.isNaN(parsed.getTime()) || (DATE_ONLY.test(trimmed) && parsed.toISOString().slice(0, 10) !== trimmed)) {
    throw new McpToolError(`"${date}" is not a valid date. Use YYYY-MM-DD.`)
  }
  // Keep a date-only expense at midday UTC so it shows on the same day in nearly every time zone.
  return DATE_ONLY.test(trimmed) ? timestamp : parsed.toISOString()
}

function assertCents(value: number, label: string) {
  if (!Number.isFinite(value) || Math.abs(value * 100 - toCents(value)) > 1e-6) {
    throw new McpToolError(`${label} must be a number with at most two decimal places.`)
  }
}

function uniqueMembers(activity: SharedActivity, references: string[]) {
  const members = references.map(reference => resolveMember(activity, reference))
  const ids = new Set(members.map(member => member.id))
  if (ids.size !== members.length) throw new McpToolError('Each person can appear only once in a split.')
  return members
}

export function buildExpense(activity: SharedActivity, input: ExpenseInput, id: string, now: Date): Expense {
  const title = input.title.trim()
  if (!title || title.length > 200) throw new McpToolError('Each expense needs a title of 1 to 200 characters.')
  assertCents(input.amount, `The amount for "${title}"`)
  if (input.amount <= 0 || input.amount > MAX_ACTIVITY_AMOUNT) {
    throw new McpToolError(`The amount for "${title}" must be above 0 and at most ${MAX_ACTIVITY_AMOUNT}.`)
  }
  const amount = fromCents(toCents(input.amount))
  const payer = resolveMember(activity, input.payer)
  let shares: Record<string, number>
  if (input.split.method === 'equal') {
    const participants = input.split.participants?.length
      ? uniqueMembers(activity, input.split.participants)
      : activityMembers(activity).filter(member => !isInactiveMember(activity.group, member.id))
    shares = createEqualShares(participants, amount)
  } else {
    const entries = Object.entries(input.split.shares)
    if (!entries.length) throw new McpToolError(`The exact split for "${title}" needs at least one person.`)
    const members = uniqueMembers(activity, entries.map(([reference]) => reference))
    shares = Object.fromEntries(entries.map(([, share], index) => {
      assertCents(share, `${members[index].name}'s share of "${title}"`)
      if (share < 0) throw new McpToolError(`${members[index].name}'s share of "${title}" can't be negative.`)
      return [members[index].id, fromCents(toCents(share))]
    }))
    const total = Object.values(shares).reduce((sum, share) => sum + toCents(share), 0)
    if (total !== toCents(amount)) {
      throw new McpToolError(`The shares for "${title}" add up to ${fromCents(total)}, not ${amount}.`)
    }
  }
  // resolveMember only returns active members, so the expense is always eligible.
  return {
    id,
    groupId: activity.group.id,
    title,
    amount,
    payerId: payer.id,
    splitMethod: input.split.method,
    shares,
    createdAt: expenseTimestamp(input.date, now),
    categoryId: resolveCategoryId(activity, input.category),
  }
}

const normalizedTitle = (title: string) => title.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

function similarTitles(first: string, second: string) {
  const a = normalizedTitle(first)
  const b = normalizedTitle(second)
  if (a === b) return true
  return Math.min(a.length, b.length) >= 3 && (a.includes(b) || b.includes(a))
}

/** An existing expense that is probably the same purchase: same amount and day, similar title. */
export function findDuplicate(expenses: Expense[], candidate: Expense) {
  return expenses.find(expense => !isSettlementPayment(expense)
    && toCents(expense.amount) === toCents(candidate.amount)
    && expense.createdAt.slice(0, 10) === candidate.createdAt.slice(0, 10)
    && similarTitles(expense.title, candidate.title)) ?? null
}

export type PlannedAdditions = {
  activity: SharedActivity
  saved: Expense[]
  skipped: { expense: Expense; duplicateOf: Expense }[]
}

export function planExpenseAdditions(
  activity: SharedActivity,
  inputs: ExpenseInput[],
  options: { allowDuplicates: boolean; now: Date; makeId: () => string },
): PlannedAdditions {
  const saved: Expense[] = []
  const skipped: PlannedAdditions['skipped'] = []
  for (const input of inputs) {
    const expense = buildExpense(activity, input, options.makeId(), options.now)
    const duplicateOf = options.allowDuplicates ? null : findDuplicate([...saved, ...activity.expenses], expense)
    if (duplicateOf) skipped.push({ expense, duplicateOf })
    else saved.push(expense)
  }
  // New expenses go first, in the order given, like a batch added in the app.
  const next = { ...activity, expenses: [...saved, ...activity.expenses] }
  if (saved.length && !isSharedActivity(next)) {
    throw new McpToolError(`${activity.group.name} would exceed Tally's size limits with these expenses.`)
  }
  return { activity: next, saved, skipped }
}

export function describeExpense(activity: SharedActivity, expense: Expense) {
  const categories = activity.group.categories ?? DEFAULT_CATEGORIES
  return {
    id: expense.id,
    date: expense.createdAt.slice(0, 10),
    title: expense.title,
    amount: expense.amount,
    kind: expense.kind ?? 'expense',
    paidBy: memberName(activity, expense.payerId),
    split: Object.entries(expense.shares).map(([memberId, amount]) => ({ member: memberName(activity, memberId), amount })),
    category: categories.find(category => category.id === expense.categoryId)?.name ?? GENERAL_CATEGORY.name,
  }
}

export function describeBalances(activity: SharedActivity) {
  return activityMembers(activity).map(member => ({
    member: member.name,
    balance: fromCents(toCents(calculateMemberBalance(member.id, activity.expenses))),
  }))
}

export function balanceChanges(before: SharedActivity, after: SharedActivity) {
  return activityMembers(after).flatMap(member => {
    const change = toCents(calculateMemberBalance(member.id, after.expenses)) - toCents(calculateMemberBalance(member.id, before.expenses))
    return change ? [{ member: member.name, change: fromCents(change) }] : []
  })
}

export function describeActivity(activity: SharedActivity, viewerId: string) {
  return {
    name: activity.group.name,
    currency: activityCurrency(activity.group),
    you: memberName(activity, viewerId),
    members: activityMembers(activity).map(member => ({
      id: member.id,
      name: member.name,
      active: !isInactiveMember(activity.group, member.id),
    })),
    categories: [GENERAL_CATEGORY, ...(activity.group.categories ?? DEFAULT_CATEGORIES)].map(category => category.name),
    totalSpending: fromCents(spendingExpenses(activity.expenses).reduce((sum, expense) => sum + toCents(expense.amount), 0)),
    balances: describeBalances(activity),
    suggestedSettlements: calculateSettlements(activityMembers(activity), activity.expenses).map(settlement => ({
      from: settlement.from.name,
      to: settlement.to.name,
      amount: settlement.amount,
    })),
  }
}

export function createActivitySnapshot(input: CreateActivityInput, makeId: (prefix: string) => string): SharedActivity {
  const name = input.name.trim()
  const creatorName = input.creatorName.trim()
  if (!name || name.length > 120) throw new McpToolError('The activity name must be 1 to 120 characters.')
  if (!creatorName || creatorName.length > 120) throw new McpToolError('Your name must be 1 to 120 characters.')
  const creatorKey = creatorName.toLocaleLowerCase()
  const friendNames = parseMemberNames(input.memberNames.join('\n')).filter(friend => friend.toLocaleLowerCase() !== creatorKey)
  if (friendNames.some(friend => friend.length > 120)) throw new McpToolError('Member names must be at most 120 characters.')
  const emoji = input.emoji?.trim() || ACTIVITY_EMOJIS[3]
  const friends = createActivityFriends(friendNames, 0).map(friend => ({ ...friend, id: makeId('friend') }))
  const groupId = makeId('group')
  const activity: SharedActivity = {
    version: 2,
    sender: { ...CURRENT_USER, name: creatorName, initials: initialsFor(creatorName) },
    group: {
      id: groupId,
      name,
      emoji,
      memberIds: ['me', ...friends.map(friend => friend.id)],
      currency: input.currency,
    },
    friends,
    expenses: [],
  }
  if (!isSharedActivity(activity)) throw new McpToolError('That activity is not valid. Check the emoji and the number of members.')
  return activity
}
