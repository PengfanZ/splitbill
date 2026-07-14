import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_STATE } from '../../data/storage'
import { CURRENT_USER } from '../../domain/members'
import type { ActivityGroup, Expense, Member } from '../../domain/models'
import {
  buildSharedActivityUrl,
  buildSharedActivityQrUrl,
  clearSharedActivityHash,
  COMPRESSED_SHARE_PREFIX,
  createSharedActivity,
  decodeSharedActivityHash,
  encodeSharedActivity,
  getSharedActivitySender,
  isSharedActivity,
  LINK_SENDER,
  MAX_SHARE_URL_LENGTH,
  MAX_QR_URL_LENGTH,
  saveSharedActivityCopy,
  SHARE_HASH_PREFIX,
  SHARE_URL_MESSAGES,
  shareActivityUrl,
  type SharedActivity,
} from './shareActivityUrl'

const maya: Member = { id: 'maya', name: 'Maya 🏖️', initials: 'M', color: '#abc' }
const group: ActivityGroup = { id: 'trip', name: '夏 Trip', emoji: '✦', memberIds: ['me', 'maya'] }
const expense: Expense = {
  id: 'dinner',
  groupId: group.id,
  title: 'Dinner',
  amount: 30,
  payerId: 'me',
  splitMethod: 'equal',
  shares: { me: 15, maya: 15 },
  createdAt: 'Today',
}
const settlementPayment: Expense = {
  id: 'settlement',
  groupId: group.id,
  title: 'Settlement payment',
  amount: 5,
  payerId: maya.id,
  splitMethod: 'exact',
  shares: { me: 5 },
  createdAt: 'Today',
  kind: 'settlement',
}
const shared = createSharedActivity(group, [CURRENT_USER, maya], [expense])

function encoded(value: unknown) {
  return `${SHARE_HASH_PREFIX}${encodeSharedActivity(value as SharedActivity)}`
}

function legacyEncoded(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  let binary = ''
  bytes.forEach(byte => { binary += String.fromCharCode(byte) })
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function incompressibleText(length: number) {
  let value = ''
  let seed = 123_456_789
  for (let index = 0; index < length; index += 1) {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0
    value += String.fromCharCode(32 + (seed % 95))
  }
  return value
}

beforeEach(() => {
  vi.restoreAllMocks()
  window.history.replaceState(null, '', '/')
  Object.defineProperty(navigator, 'share', { configurable: true, value: undefined })
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
})

describe('URL activity serialization', () => {
  it('creates a portable snapshot without duplicating the current user', () => {
    expect(shared).toEqual({ version: 2, sender: CURRENT_USER, group, friends: [maya], expenses: [expense] })
    expect(isSharedActivity(shared)).toBe(true)
    expect(isSharedActivity({ ...shared, version: 3 })).toBe(false)
    expect(createSharedActivity(group, [maya], [expense]).sender).toBe(CURRENT_USER)
    expect(getSharedActivitySender(shared)).toBe(CURRENT_USER)
    expect(getSharedActivitySender({ ...shared, sender: undefined } as unknown as SharedActivity)).toBe(LINK_SENDER)
    expect(isSharedActivity({ ...shared, expenses: [{ ...expense, kind: 'expense' }, settlementPayment] })).toBe(true)
  })

  it('round-trips Unicode activity state through a URL-safe fragment', () => {
    const token = encodeSharedActivity(shared)
    expect(token).toMatch(new RegExp(`^${COMPRESSED_SHARE_PREFIX.replace('.', '\\.')}`))
    expect(token.length).toBeLessThan(legacyEncoded(shared).length)
    expect(decodeSharedActivityHash(`${SHARE_HASH_PREFIX}${token}`)).toEqual(shared)
    expect(decodeSharedActivityHash(`${SHARE_HASH_PREFIX}${legacyEncoded(shared)}`)).toEqual(shared)

    const url = buildSharedActivityUrl(shared, 'https://example.com/splitbill/?mode=test#old')
    expect(url).toMatch(/^https:\/\/example\.com\/splitbill\/\?mode=test#share=/)
    expect(decodeSharedActivityHash(new URL(url).hash)).toEqual(shared)

    const legacy = { version: 1, group: shared.group, friends: shared.friends, expenses: shared.expenses }
    expect(decodeSharedActivityHash(encoded(legacy))).toEqual({ ...shared, sender: LINK_SENDER })
  })

  it('rejects missing, corrupt, unsupported, and structurally unsafe payloads', () => {
    expect(decodeSharedActivityHash('')).toBeNull()
    expect(decodeSharedActivityHash('#other=value')).toBeNull()
    expect(decodeSharedActivityHash(`${SHARE_HASH_PREFIX}%%%`)).toBeNull()
    expect(decodeSharedActivityHash(`${SHARE_HASH_PREFIX}${COMPRESSED_SHARE_PREFIX}%%%`)).toBeNull()
    expect(decodeSharedActivityHash(`${SHARE_HASH_PREFIX}${btoa('not json')}`)).toBeNull()

    const invalid: unknown[] = [
      null,
      [],
      { ...shared, version: 3 },
      { ...shared, sender: null },
      { ...shared, sender: { ...CURRENT_USER, id: 'someone-else' } },
      { ...shared, group: null },
      { ...shared, group: { ...group, id: 1 } },
      { ...shared, group: { ...group, name: 1 } },
      { ...shared, group: { ...group, emoji: 1 } },
      { ...shared, group: { ...group, memberIds: {} } },
      { ...shared, group: { ...group, memberIds: ['me', 1] } },
      { ...shared, friends: {} },
      { ...shared, friends: [null] },
      { ...shared, friends: [{ ...maya, id: 1 }] },
      { ...shared, friends: [{ ...maya, name: 1 }] },
      { ...shared, friends: [{ ...maya, initials: 1 }] },
      { ...shared, friends: [{ ...maya, color: 1 }] },
      { ...shared, expenses: {} },
      { ...shared, expenses: [null] },
      { ...shared, expenses: [{ ...expense, id: 1 }] },
      { ...shared, expenses: [{ ...expense, groupId: 1 }] },
      { ...shared, expenses: [{ ...expense, title: 1 }] },
      { ...shared, expenses: [{ ...expense, amount: '30' }] },
      { ...shared, expenses: [{ ...expense, amount: Number.POSITIVE_INFINITY }] },
      { ...shared, expenses: [{ ...expense, amount: -1 }] },
      { ...shared, expenses: [{ ...expense, payerId: 1 }] },
      { ...shared, expenses: [{ ...expense, splitMethod: 'percent' }] },
      { ...shared, expenses: [{ ...expense, shares: null }] },
      { ...shared, expenses: [{ ...expense, shares: { me: '15' } }] },
      { ...shared, expenses: [{ ...expense, shares: { me: Number.POSITIVE_INFINITY } }] },
      { ...shared, expenses: [{ ...expense, shares: { me: -1 } }] },
      { ...shared, expenses: [{ ...expense, createdAt: 1 }] },
      { ...shared, expenses: [{ ...expense, kind: 'refund' }] },
      { ...shared, expenses: [{ ...settlementPayment, amount: 0 }] },
      { ...shared, expenses: [{ ...settlementPayment, splitMethod: 'equal' }] },
      { ...shared, expenses: [{ ...settlementPayment, shares: { me: 4 } }] },
      { ...shared, expenses: [{ ...settlementPayment, shares: { me: 5, maya: 0 } }] },
      { ...shared, expenses: [{ ...settlementPayment, payerId: 'me', shares: { me: 5 } }] },
      { ...shared, group: { ...group, memberIds: ['me', 'missing'] } },
      { ...shared, expenses: [{ ...expense, groupId: 'other' }] },
      { ...shared, expenses: [{ ...expense, payerId: 'missing' }] },
      { ...shared, expenses: [{ ...expense, shares: { missing: 30 } }] },
    ]

    invalid.forEach(value => expect(decodeSharedActivityHash(encoded(value))).toBeNull())
  })

  it('enforces a conservative URL size limit', () => {
    const oversized = { ...shared, group: { ...group, name: incompressibleText(MAX_SHARE_URL_LENGTH) } }
    expect(() => buildSharedActivityUrl(oversized)).toThrow(RangeError)
  })

  it('keeps QR links below a reliable scanning limit without reducing copy-link capacity', () => {
    expect(buildSharedActivityQrUrl(shared, 'https://example.com/splitbill/')).toBe(buildSharedActivityUrl(shared, 'https://example.com/splitbill/'))

    const qrOversized = { ...shared, group: { ...group, name: incompressibleText(MAX_QR_URL_LENGTH * 2) } }
    expect(buildSharedActivityUrl(qrOversized).length).toBeLessThan(MAX_SHARE_URL_LENGTH)
    expect(() => buildSharedActivityQrUrl(qrOversized)).toThrow(RangeError)
  })
})

describe('URL activity sharing and saving', () => {
  it('shares natively and reports cancellation', async () => {
    const nativeShare = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'share', { configurable: true, value: nativeShare })

    expect(await shareActivityUrl(shared, 'https://example.com/splitbill/')).toBe('shared')
    expect(nativeShare).toHaveBeenCalledWith(expect.objectContaining({
      title: '夏 Trip — Tally',
      url: expect.stringContaining('#share='),
    }))

    nativeShare.mockRejectedValueOnce(new DOMException('cancelled', 'AbortError'))
    expect(await shareActivityUrl(shared)).toBe('cancelled')
  })

  it('prefers the clipboard and reports clipboard, share, or URL failures', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    const nativeShare = vi.fn().mockRejectedValue(new Error('unsupported'))
    Object.defineProperty(navigator, 'share', { configurable: true, value: nativeShare })
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })

    expect(await shareActivityUrl(shared)).toBe('copied')
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('#share='))
    expect(nativeShare).not.toHaveBeenCalled()
    writeText.mockRejectedValueOnce(new Error('blocked'))
    expect(await shareActivityUrl(shared)).toBe('failed')
    expect(nativeShare).toHaveBeenCalledOnce()

    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
    expect(await shareActivityUrl(shared)).toBe('failed')
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined })
    expect(await shareActivityUrl(shared)).toBe('failed')
    expect(await shareActivityUrl(shared, 'not a URL')).toBe('failed')

    const oversized = { ...shared, group: { ...group, name: incompressibleText(MAX_SHARE_URL_LENGTH) } }
    expect(await shareActivityUrl(oversized)).toBe('too-large')
    expect(SHARE_URL_MESSAGES['too-large']).toContain('too large')
  })

  it('saves an isolated local copy with consistently remapped IDs', () => {
    const result = saveSharedActivityCopy(EMPTY_STATE, shared, 'me')
    const copiedGroup = result.groups[0]
    const copiedFriend = result.friends[0]
    const copiedExpense = result.expenses[0]

    expect(copiedGroup.id).not.toBe(group.id)
    expect(copiedFriend).toMatchObject({ name: maya.name, initials: maya.initials, color: maya.color })
    expect(copiedFriend.id).not.toBe(maya.id)
    expect(copiedGroup.memberIds).toEqual(['me', copiedFriend.id])
    expect(copiedExpense).toMatchObject({ groupId: copiedGroup.id, payerId: 'me' })
    expect(copiedExpense.id).not.toBe(expense.id)
    expect(copiedExpense.shares).toEqual({ me: 15, [copiedFriend.id]: 15 })
    expect(result.selectedGroupId).toBe(copiedGroup.id)

    const withExisting = saveSharedActivityCopy({ ...EMPTY_STATE, groups: [group], friends: [maya], expenses: [expense] }, shared, 'me')
    expect(withExisting.groups).toHaveLength(2)
    expect(withExisting.friends).toHaveLength(2)
    expect(withExisting.expenses.at(-1)).toBe(expense)
  })

  it('remaps the selected friend to the local current user', () => {
    const namedShared = { ...shared, sender: { ...CURRENT_USER, name: 'Pengfan', initials: 'P' }, expenses: [expense, settlementPayment] }
    const result = saveSharedActivityCopy(EMPTY_STATE, namedShared, maya.id)
    const linkSender = result.friends.find(friend => friend.name === 'Pengfan')

    expect(result.friends.some(friend => friend.name === maya.name)).toBe(false)
    expect(linkSender).toBeDefined()
    expect(result.groups[0].memberIds).toEqual([linkSender?.id, 'me'])
    expect(result.expenses[0].payerId).toBe(linkSender?.id)
    expect(result.expenses[0].shares).toEqual({ [linkSender!.id]: 15, me: 15 })
    expect(result.expenses[1]).toMatchObject({ kind: 'settlement', payerId: 'me', shares: { [linkSender!.id]: 5 } })
    expect(() => saveSharedActivityCopy(EMPTY_STATE, shared, 'missing')).toThrow(RangeError)
  })

  it('clears only the shared fragment from the current URL', () => {
    window.history.replaceState(null, '', '/splitbill/?mode=test#share=payload')
    clearSharedActivityHash()
    expect(window.location.pathname).toBe('/splitbill/')
    expect(window.location.search).toBe('?mode=test')
    expect(window.location.hash).toBe('')
  })
})
