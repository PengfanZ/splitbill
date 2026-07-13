import { makeId } from '../../domain/members'
import type { ActivityGroup, Expense, Member, PersistedState } from '../../domain/models'

export const SHARE_HASH_PREFIX = '#share='
export const MAX_SHARE_URL_LENGTH = 12_000

export type SharedActivity = {
  version: 1
  group: ActivityGroup
  friends: Member[]
  expenses: Expense[]
}

export type ShareUrlResult = 'shared' | 'copied' | 'cancelled' | 'too-large' | 'failed'

export const SHARE_URL_MESSAGES: Record<ShareUrlResult, string> = {
  shared: 'Activity link shared. Anyone with it can view this snapshot.',
  copied: 'Activity link copied. Anyone with it can view this snapshot.',
  cancelled: 'Sharing cancelled.',
  'too-large': 'This activity is too large for a reliable URL. File sharing will be a better fit.',
  failed: 'Could not share the activity link. Please try again.',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function isMember(value: unknown): value is Member {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.name === 'string'
    && typeof value.initials === 'string'
    && typeof value.color === 'string'
}

function isGroup(value: unknown): value is ActivityGroup {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.name === 'string'
    && typeof value.emoji === 'string'
    && isStringArray(value.memberIds)
}

function isShares(value: unknown): value is Record<string, number> {
  return isRecord(value)
    && Object.values(value).every(share => typeof share === 'number' && Number.isFinite(share) && share >= 0)
}

function isExpense(value: unknown): value is Expense {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.groupId === 'string'
    && typeof value.title === 'string'
    && typeof value.amount === 'number'
    && Number.isFinite(value.amount)
    && value.amount >= 0
    && typeof value.payerId === 'string'
    && (value.splitMethod === 'equal' || value.splitMethod === 'exact')
    && isShares(value.shares)
    && typeof value.createdAt === 'string'
}

function isSharedActivity(value: unknown): value is SharedActivity {
  if (!isRecord(value) || value.version !== 1) return false
  const group = value.group
  if (!isGroup(group)) return false
  if (!Array.isArray(value.friends) || !value.friends.every(isMember)) return false
  if (!Array.isArray(value.expenses) || !value.expenses.every(isExpense)) return false

  const memberIds = new Set(['me', ...value.friends.map(friend => friend.id)])
  return group.memberIds.every(memberId => memberIds.has(memberId))
    && value.expenses.every(expense => (
      expense.groupId === group.id
      && memberIds.has(expense.payerId)
      && Object.keys(expense.shares).every(memberId => memberIds.has(memberId))
    ))
}

function toBase64Url(value: string) {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  bytes.forEach(byte => { binary += String.fromCharCode(byte) })
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function fromBase64Url(value: string) {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const binary = atob(padded)
  return new TextDecoder().decode(Uint8Array.from(binary, character => character.charCodeAt(0)))
}

export function createSharedActivity(group: ActivityGroup, members: Member[], expenses: Expense[]): SharedActivity {
  return {
    version: 1,
    group,
    friends: members.filter(member => member.id !== 'me'),
    expenses,
  }
}

export function encodeSharedActivity(activity: SharedActivity) {
  return toBase64Url(JSON.stringify(activity))
}

export function decodeSharedActivityHash(hash: string): SharedActivity | null {
  if (!hash.startsWith(SHARE_HASH_PREFIX)) return null
  try {
    const parsed: unknown = JSON.parse(fromBase64Url(hash.slice(SHARE_HASH_PREFIX.length)))
    return isSharedActivity(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function buildSharedActivityUrl(activity: SharedActivity, currentUrl = window.location.href) {
  const url = new URL(currentUrl)
  url.hash = `${SHARE_HASH_PREFIX.slice(1)}${encodeSharedActivity(activity)}`
  if (url.href.length > MAX_SHARE_URL_LENGTH) throw new RangeError('Shared activity URL is too large')
  return url.href
}

export async function shareActivityUrl(activity: SharedActivity, currentUrl = window.location.href): Promise<ShareUrlResult> {
  let url: string
  try {
    url = buildSharedActivityUrl(activity, currentUrl)
  } catch (error) {
    return error instanceof RangeError ? 'too-large' : 'failed'
  }

  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: `${activity.group.name} — Tally`, url })
      return 'shared'
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled'
    }
  }

  if (typeof navigator.clipboard?.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(url)
      return 'copied'
    } catch {
      return 'failed'
    }
  }

  return 'failed'
}

export function saveSharedActivityCopy(current: PersistedState, activity: SharedActivity): PersistedState {
  const groupId = makeId('group')
  const memberIdMap = new Map<string, string>([['me', 'me']])
  const friends = activity.friends.map(friend => {
    const id = makeId('friend')
    memberIdMap.set(friend.id, id)
    return { ...friend, id }
  })
  const group: ActivityGroup = {
    ...activity.group,
    id: groupId,
    memberIds: activity.group.memberIds.map(memberId => memberIdMap.get(memberId)!),
  }
  const expenses = activity.expenses.map(expense => ({
    ...expense,
    id: makeId('expense'),
    groupId,
    payerId: memberIdMap.get(expense.payerId)!,
    shares: Object.fromEntries(Object.entries(expense.shares).map(([memberId, share]) => [memberIdMap.get(memberId)!, share])),
  }))

  return {
    groups: [...current.groups, group],
    friends: [...current.friends, ...friends],
    expenses: [...expenses, ...current.expenses],
    selectedGroupId: groupId,
  }
}

export function clearSharedActivityHash() {
  const url = new URL(window.location.href)
  url.hash = ''
  window.history.replaceState(null, '', url)
}
