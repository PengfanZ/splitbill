import { DEFAULT_CATEGORIES, GENERAL_CATEGORY } from '../../domain/categories'
import { activityCurrency, type CurrencyCode } from '../../domain/currency'
import {
  calculateMemberBalance,
  calculateSettlements,
  createEqualShares,
  createSettlementPayment,
  isSettlementPayment,
  spendingExpenses,
} from '../../domain/expenses'
import { isInactiveMember, restoreActivityFriend } from '../../domain/memberRemoval'
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

export type ExpenseChanges = Partial<ExpenseInput>

export type SettlementInput = {
  from: string
  to: string
  amount: number
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

/** Finds an active member by id or name. Removed members in `keep` count as active, such as the people already on an expense. */
export function resolveMember(activity: SharedActivity, reference: string, keep: ReadonlySet<string> = new Set()): Member {
  const members = activityMembers(activity)
  const trimmed = reference.trim()
  const key = trimmed.toLocaleLowerCase()
  const matches = members.some(member => member.id === trimmed)
    ? members.filter(member => member.id === trimmed)
    : members.filter(member => member.name.trim().toLocaleLowerCase() === key)
  const active = matches.filter(member => !isInactiveMember(activity.group, member.id) || keep.has(member.id))
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

function uniqueMembers(activity: SharedActivity, references: string[], keep: ReadonlySet<string>) {
  const members = references.map(reference => resolveMember(activity, reference, keep))
  const ids = new Set(members.map(member => member.id))
  if (ids.size !== members.length) throw new McpToolError('Each person can appear only once in a split.')
  return members
}

function checkedTitle(value: string) {
  const title = value.trim()
  if (!title || title.length > 200) throw new McpToolError('Each expense needs a title of 1 to 200 characters.')
  return title
}

function checkedAmount(value: number, label: string) {
  assertCents(value, label)
  if (value <= 0 || value > MAX_ACTIVITY_AMOUNT) throw new McpToolError(`${label} must be above 0 and at most ${MAX_ACTIVITY_AMOUNT}.`)
  return fromCents(toCents(value))
}

function splitShares(activity: SharedActivity, title: string, amount: number, split: SplitInput, keep: ReadonlySet<string>) {
  if (split.method === 'equal') {
    const participants = split.participants?.length
      ? uniqueMembers(activity, split.participants, keep)
      : activityMembers(activity).filter(member => !isInactiveMember(activity.group, member.id))
    return { splitMethod: split.method, shares: createEqualShares(participants, amount) }
  }
  const entries = Object.entries(split.shares)
  if (!entries.length) throw new McpToolError(`The exact split for "${title}" needs at least one person.`)
  const members = uniqueMembers(activity, entries.map(([reference]) => reference), keep)
  const shares = Object.fromEntries(entries.map(([, share], index) => {
    assertCents(share, `${members[index].name}'s share of "${title}"`)
    if (share < 0) throw new McpToolError(`${members[index].name}'s share of "${title}" can't be negative.`)
    return [members[index].id, fromCents(toCents(share))]
  }))
  const total = Object.values(shares).reduce((sum, share) => sum + toCents(share), 0)
  if (total !== toCents(amount)) {
    throw new McpToolError(`The shares for "${title}" add up to ${fromCents(total)}, not ${amount}.`)
  }
  return { splitMethod: split.method, shares }
}

function ensureStorable(activity: SharedActivity, message: string) {
  if (!isSharedActivity(activity)) throw new McpToolError(message)
}

export function buildExpense(activity: SharedActivity, input: ExpenseInput, id: string, now: Date): Expense {
  const title = checkedTitle(input.title)
  const amount = checkedAmount(input.amount, `The amount for "${title}"`)
  const payer = resolveMember(activity, input.payer)
  // resolveMember only returns active members here, so the expense is always eligible.
  return {
    id,
    groupId: activity.group.id,
    title,
    amount,
    payerId: payer.id,
    ...splitShares(activity, title, amount, input.split, new Set()),
    createdAt: expenseTimestamp(input.date, now),
    categoryId: resolveCategoryId(activity, input.category),
  }
}

/** A payment shaped like one recorded in the app. It can't exceed what the payer owes or what the recipient is owed. */
export function buildSettlement(activity: SharedActivity, input: SettlementInput, id: string, now: Date): Expense {
  // Removed friends keep their balances, so they can still pay or be paid back.
  const everyone = new Set(activityMembers(activity).map(member => member.id))
  const from = resolveMember(activity, input.from, everyone)
  const to = resolveMember(activity, input.to, everyone)
  if (from.id === to.id) throw new McpToolError('A payment needs two different people.')
  const amount = checkedAmount(input.amount, 'The payment amount')
  const name = activity.group.name
  const owes = -toCents(calculateMemberBalance(from.id, activity.expenses))
  const owed = toCents(calculateMemberBalance(to.id, activity.expenses))
  if (owes <= 0) throw new McpToolError(`${from.name} doesn't owe anything in ${name}.`)
  if (owed <= 0) throw new McpToolError(`${to.name} isn't owed anything in ${name}.`)
  if (toCents(amount) > owes) throw new McpToolError(`${from.name} owes ${fromCents(owes)} in ${name}, less than ${amount}.`)
  if (toCents(amount) > owed) throw new McpToolError(`${to.name} is owed ${fromCents(owed)} in ${name}, less than ${amount}.`)
  return createSettlementPayment(activity.group.id, { from, to, amount: fromCents(Math.min(owes, owed)) }, amount, id, expenseTimestamp(input.date, now))
}

const normalizedTitle = (title: string) => title.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
const COMMON_WORDS = new Set(['and', 'for', 'from', 'the', 'with'])
const titleWords = (title: string) => title.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u)
  .filter(word => word.length >= 3 && !COMMON_WORDS.has(word))

/** Agents reword statement lines ("SUICA MOBILE TOPUP"), so one shared word is enough once amount and day match. */
function similarTitles(first: string, second: string) {
  const a = normalizedTitle(first)
  const b = normalizedTitle(second)
  if (a === b) return true
  if (Math.min(a.length, b.length) >= 3 && (a.includes(b) || b.includes(a))) return true
  const words = new Set(titleWords(first))
  return titleWords(second).some(word => words.has(word))
}

/** An existing expense that is probably the same purchase: same payer, amount and day, similar title. */
export function findDuplicate(expenses: Expense[], candidate: Expense) {
  return expenses.find(expense => !isSettlementPayment(expense)
    && expense.payerId === candidate.payerId
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
  if (saved.length) ensureStorable(next, `${activity.group.name} would exceed Tally's size limits with these expenses.`)
  return { activity: next, saved, skipped }
}

export function planSettlement(activity: SharedActivity, input: SettlementInput, id: string, now: Date) {
  const saved = buildSettlement(activity, input, id, now)
  const next = { ...activity, expenses: [saved, ...activity.expenses] }
  ensureStorable(next, `${activity.group.name} would exceed Tally's size limits with this payment.`)
  return { activity: next, saved }
}

/** Adds friends by name. A removed friend with the same name comes back instead of being duplicated. */
export function planMemberAdditions(activity: SharedActivity, names: string[], makeId: (prefix: string) => string) {
  const parsed = parseMemberNames(names.join('\n'))
  if (!parsed.length) throw new McpToolError('Give at least one name.')
  if (parsed.some(name => name.length > 120)) throw new McpToolError('Names must be at most 120 characters.')
  let next = activity
  const added: string[] = []
  const restored: string[] = []
  const alreadyIn: string[] = []
  for (const name of parsed) {
    const key = name.toLocaleLowerCase()
    const matches = activityMembers(next).filter(member => member.name.trim().toLocaleLowerCase() === key)
    const active = matches.find(member => !isInactiveMember(next.group, member.id))
    if (active) alreadyIn.push(active.name)
    else if (matches.length) {
      // Restoring keeps an empty inactiveMemberIds list, which Live saves require once it exists.
      next = restoreActivityFriend(next, matches[0].id)!
      restored.push(matches[0].name)
    } else added.push(name)
  }
  if (added.length) {
    const friends = createActivityFriends(added, activity.friends.length).map(friend => ({ ...friend, id: makeId('friend') }))
    next = {
      ...next,
      friends: [...next.friends, ...friends],
      group: { ...next.group, memberIds: [...next.group.memberIds, ...friends.map(friend => friend.id)] },
    }
  }
  if (next !== activity) ensureStorable(next, `${activity.group.name} would exceed Tally's size limits with these people.`)
  return { activity: next, added, restored, alreadyIn }
}

/** Identifies the version of an expense the agent read: its last edit, or its creation for one never edited. */
export const expenseVersion = (expense: Expense) => expense.updatedAt ?? expense.createdAt

function findUnchangedExpense(activity: SharedActivity, expenseId: string, version: string) {
  const expense = activity.expenses.find(item => item.id === expenseId)
  if (!expense) {
    throw new McpToolError(`No expense with id "${expenseId}" in ${activity.group.name}. It may have been deleted; read the activity again with get_activity.`)
  }
  if (expenseVersion(expense) !== version) {
    throw new McpToolError(`"${expense.title}" changed since you read it, so nothing was saved. It is now: ${JSON.stringify(describeExpense(activity, expense))}. Check with the user before trying again.`)
  }
  return expense
}

export function planExpenseUpdate(activity: SharedActivity, expenseId: string, version: string, changes: ExpenseChanges, now: Date) {
  const before = findUnchangedExpense(activity, expenseId, version)
  if (isSettlementPayment(before)) {
    throw new McpToolError(`"${before.title}" is a payment between people. Delete it and record the right one with record_settlement instead.`)
  }
  if (!Object.values(changes).some(value => value !== undefined)) throw new McpToolError('Say what to change.')
  // People already on the expense may stay on it after being removed, like edits in the app.
  const keep = new Set([before.payerId, ...Object.keys(before.shares)])
  const title = changes.title === undefined ? before.title : checkedTitle(changes.title)
  const amount = changes.amount === undefined ? before.amount : checkedAmount(changes.amount, `The amount for "${title}"`)
  let split = changes.split
  if (!split && toCents(amount) !== toCents(before.amount)) {
    if (before.splitMethod === 'exact') {
      throw new McpToolError(`"${before.title}" has an exact split, so give the new split along with the new amount.`)
    }
    split = { method: 'equal', participants: Object.keys(before.shares) }
  }
  const after: Expense = {
    ...before,
    title,
    amount,
    payerId: changes.payer === undefined ? before.payerId : resolveMember(activity, changes.payer, keep).id,
    ...(split ? splitShares(activity, title, amount, split, keep) : {}),
    createdAt: changes.date === undefined ? before.createdAt : expenseTimestamp(changes.date, now),
    ...(changes.category === undefined ? {} : { categoryId: resolveCategoryId(activity, changes.category) }),
    updatedAt: now.toISOString(),
  }
  const next = { ...activity, expenses: activity.expenses.map(expense => expense.id === before.id ? after : expense) }
  ensureStorable(next, `${activity.group.name} can't store this change.`)
  return { activity: next, before, after }
}

export function planExpenseDeletion(activity: SharedActivity, expenseId: string, version: string) {
  const deleted = findUnchangedExpense(activity, expenseId, version)
  return { activity: { ...activity, expenses: activity.expenses.filter(expense => expense.id !== deleted.id) }, deleted }
}

export function describeExpense(activity: SharedActivity, expense: Expense) {
  const categories = activity.group.categories ?? DEFAULT_CATEGORIES
  return {
    id: expense.id,
    version: expenseVersion(expense),
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
