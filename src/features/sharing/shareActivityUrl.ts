import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string'
import { CURRENT_USER, makeId } from '../../domain/members'
import type { ActivityGroup, Expense, Member, PersistedState } from '../../domain/models'
import { shareLink } from './shareLink'
import {
  legacySharedActivitySchema,
  sharedActivitySchema,
  type SharedActivity,
} from './sharedActivitySchema'

export {
  MAX_ACTIVITY_AMOUNT,
  MAX_ACTIVITY_EXPENSES,
  MAX_ACTIVITY_FRIENDS,
  MAX_ACTIVITY_SNAPSHOT_BYTES,
  type SharedActivity,
} from './sharedActivitySchema'

export const SHARE_HASH_PREFIX = '#share='
export const COMPRESSED_SHARE_PREFIX = 'z.'
export const MAX_SHARE_URL_LENGTH = 12_000
export const MAX_QR_URL_LENGTH = 2_000
export const LINK_SENDER: Member = {
  ...CURRENT_USER,
  name: 'Link sender',
  initials: 'LS',
}

export function getSharedActivitySender(activity: SharedActivity) {
  return activity.sender ?? LINK_SENDER
}

function getRemappedMemberId(memberIdMap: Map<string, string>, memberId: string) {
  const remappedMemberId = memberIdMap.get(memberId)
  if (!remappedMemberId) throw new RangeError('Activity references an unknown participant')
  return remappedMemberId
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

function fromBase64Url(value: string) {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const binary = atob(padded)
  return new TextDecoder().decode(Uint8Array.from(binary, character => character.charCodeAt(0)))
}

export function createSharedActivity(group: ActivityGroup, members: Member[], expenses: Expense[]): SharedActivity {
  return {
    version: 2,
    sender: members.find(member => member.id === 'me') ?? CURRENT_USER,
    group,
    friends: members.filter(member => member.id !== 'me'),
    expenses,
  }
}

export function isSharedActivity(value: unknown): value is SharedActivity {
  return sharedActivitySchema.safeParse(value).success
}

export function encodeSharedActivity(activity: SharedActivity) {
  return `${COMPRESSED_SHARE_PREFIX}${compressToEncodedURIComponent(JSON.stringify(activity))}`
}

export function decodeSharedActivityHash(hash: string): SharedActivity | null {
  if (!hash.startsWith(SHARE_HASH_PREFIX)) return null
  try {
    const token = hash.slice(SHARE_HASH_PREFIX.length)
    const serialized = token.startsWith(COMPRESSED_SHARE_PREFIX)
      ? decompressFromEncodedURIComponent(token.slice(COMPRESSED_SHARE_PREFIX.length))
      : fromBase64Url(token)
    if (!serialized) return null
    const parsed: unknown = JSON.parse(serialized)
    if (!isRecord(parsed)) return null
    if (legacySharedActivitySchema.safeParse(parsed).success) {
      return { ...parsed, version: 2, sender: LINK_SENDER } as SharedActivity
    }
    if (!isSharedActivity(parsed)) return null
    return parsed as SharedActivity
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

export function buildSharedActivityQrUrl(activity: SharedActivity, currentUrl = window.location.href) {
  const url = buildSharedActivityUrl(activity, currentUrl)
  if (url.length > MAX_QR_URL_LENGTH) throw new RangeError('Shared activity is too large for a reliable QR code')
  return url
}

export async function shareActivityUrl(activity: SharedActivity, currentUrl = window.location.href): Promise<ShareUrlResult> {
  let url: string
  try {
    url = buildSharedActivityUrl(activity, currentUrl)
  } catch (error) {
    return error instanceof RangeError ? 'too-large' : 'failed'
  }

  return shareLink(`${activity.group.name} — Tally`, url, `Open ${activity.group.name} in Tally.`)
}

export function saveSharedActivityCopy(current: PersistedState, activity: SharedActivity, viewerId: string): PersistedState {
  if (!activity.group.memberIds.includes(viewerId)) throw new RangeError('Selected participant is not part of this activity')
  const groupId = makeId('group')
  const memberIdMap = new Map<string, string>([[viewerId, 'me']])
  const friends = [getSharedActivitySender(activity), ...activity.friends].filter(member => member.id !== viewerId).map(friend => {
    const id = makeId('friend')
    memberIdMap.set(friend.id, id)
    return { ...friend, id }
  })
  const group: ActivityGroup = {
    ...activity.group,
    id: groupId,
    memberIds: activity.group.memberIds.map(memberId => getRemappedMemberId(memberIdMap, memberId)),
  }
  const expenses = activity.expenses.map(expense => ({
    ...expense,
    id: makeId('expense'),
    groupId,
    payerId: getRemappedMemberId(memberIdMap, expense.payerId),
    shares: Object.fromEntries(
      Object.entries(expense.shares).map(([memberId, share]) => [getRemappedMemberId(memberIdMap, memberId), share]),
    ),
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
