import { describe, expect, it } from 'vitest'
import {
  buildLiveActivityUrl,
  clearLiveActivityHash,
  isLiveActivityCredentials,
  LIVE_ACTIVITY_HASH_PREFIX,
  parseLiveActivityHash,
} from './liveActivityLink'

const credentials = { code: 'A1B2C3D4E5', editToken: 'a'.repeat(64) }

describe('live activity capability links', () => {
  it('builds and parses a short capability URL', () => {
    const url = buildLiveActivityUrl(credentials, 'https://example.com/splitbill/?old=true#share=old')
    expect(url).toBe(`https://example.com/splitbill/?old=true${LIVE_ACTIVITY_HASH_PREFIX}${credentials.code}.${credentials.editToken}`)
    expect(parseLiveActivityHash(new URL(url).hash)).toEqual(credentials)
    expect(isLiveActivityCredentials(credentials)).toBe(true)
  })

  it.each([
    null,
    {},
    { ...credentials, code: 'short' },
    { ...credentials, code: 'a1b2c3d4e5' },
    { ...credentials, editToken: 'short' },
    { ...credentials, editToken: 'G'.repeat(64) },
  ])('rejects invalid credentials: %j', value => {
    expect(isLiveActivityCredentials(value)).toBe(false)
    expect(() => buildLiveActivityUrl(value as typeof credentials)).toThrow(RangeError)
  })

  it.each([
    '',
    '#share=old',
    '#live=',
    `#live=${credentials.code}`,
    `#live=${credentials.code}.${credentials.editToken}.extra`,
    `#live=BADCODE.${credentials.editToken}`,
  ])('rejects invalid live activity hashes: %s', hash => {
    expect(parseLiveActivityHash(hash)).toBeNull()
  })

  it('clears a live capability from the current address', () => {
    window.history.replaceState(null, '', `/splitbill/${LIVE_ACTIVITY_HASH_PREFIX}${credentials.code}.${credentials.editToken}`)
    clearLiveActivityHash()
    expect(window.location.hash).toBe('')
    expect(window.location.pathname).toBe('/splitbill/')
  })
})
