import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CURRENT_USER } from '../domain/members'
import { createIdentity, IDENTITY_KEY, loadIdentity, parseIdentity, saveIdentity } from './identity'

beforeEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('local identity persistence', () => {
  it('creates a trimmed browser-local identity', () => {
    expect(createIdentity('  Pengfan Zhang  ')).toEqual({
      ...CURRENT_USER,
      name: 'Pengfan Zhang',
      initials: 'PZ',
    })
    expect(() => createIdentity('   ')).toThrow(RangeError)
  })

  it('parses only complete current-user identities', () => {
    const valid = createIdentity('Pengfan')
    expect(parseIdentity(JSON.stringify(valid))).toEqual(valid)
    expect(parseIdentity(null)).toBeNull()

    const invalid: unknown[] = [
      null,
      [],
      {},
      { ...valid, id: 'friend' },
      { ...valid, name: 1 },
      { ...valid, name: ' ' },
      { id: 'me', name: 'Pengfan' },
      { ...valid, initials: 1 },
      { id: 'me', name: 'Pengfan', initials: 'P' },
      { ...valid, color: 1 },
    ]
    invalid.forEach(value => expect(parseIdentity(JSON.stringify(value))).toBeNull())
    expect(parseIdentity('{')).toBeNull()
  })

  it('loads, deduplicates, saves, and tolerates blocked storage', () => {
    const identity = createIdentity('Pengfan')
    expect(loadIdentity()).toBeNull()
    saveIdentity(identity)
    expect(localStorage.getItem(IDENTITY_KEY)).toBe(JSON.stringify(identity))
    expect(loadIdentity()).toEqual(identity)

    const setItem = vi.spyOn(localStorage, 'setItem')
    saveIdentity(identity)
    expect(setItem).not.toHaveBeenCalled()
    setItem.mockImplementation(() => { throw new Error('blocked') })
    expect(() => saveIdentity(createIdentity('New name'))).not.toThrow()

    vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    expect(loadIdentity()).toBeNull()
    expect(() => saveIdentity(identity)).not.toThrow()
  })
})
