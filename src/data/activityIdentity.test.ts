import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ACTIVITY_IDENTITY_KEY,
  loadActivityIdentitySelections,
  parseActivityIdentitySelections,
  removeActivityIdentity,
  saveActivityIdentitySelections,
  selectActivityIdentity,
} from './activityIdentity'

describe('activity identity persistence', () => {
  beforeEach(() => localStorage.clear())

  it('parses only usable activity-to-member selections', () => {
    expect(parseActivityIdentitySelections(null)).toEqual({})
    expect(parseActivityIdentitySelections('{')).toEqual({})
    expect(parseActivityIdentitySelections('[]')).toEqual({})
    expect(parseActivityIdentitySelections(JSON.stringify({
      'local:trip': 'maya',
      'live:ABC': 'jordan',
      emptyMember: '',
      numberMember: 2,
      '': 'me',
    }))).toEqual({ 'local:trip': 'maya', 'live:ABC': 'jordan' })
  })

  it('loads, saves, selects, and removes identities defensively', () => {
    expect(loadActivityIdentitySelections()).toEqual({})
    const selected = selectActivityIdentity({}, 'live:ABC', 'maya')
    saveActivityIdentitySelections(selected)
    expect(localStorage.getItem(ACTIVITY_IDENTITY_KEY)).toBe(JSON.stringify(selected))
    expect(loadActivityIdentitySelections()).toEqual(selected)
    expect(removeActivityIdentity(selected, 'missing')).toBe(selected)
    expect(removeActivityIdentity(selected, 'live:ABC')).toEqual({})

    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    expect(() => saveActivityIdentitySelections(selected)).not.toThrow()
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    expect(loadActivityIdentitySelections()).toEqual({})
  })
})
