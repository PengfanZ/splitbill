import { beforeEach, describe, expect, it } from 'vitest'
import { initializeAnalytics } from './analytics'

const beaconSelector =
  'script[src="https://static.cloudflareinsights.com/beacon.min.js"]'

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('initializeAnalytics', () => {
  it('loads the deferred Cloudflare beacon when analytics is enabled', () => {
    initializeAnalytics(true)

    const script = document.querySelector<HTMLScriptElement>(beaconSelector)
    expect(script).not.toBeNull()
    expect(script?.defer).toBe(true)
    expect(script?.dataset.cfBeacon).toBe(
      JSON.stringify({ token: 'e7952cd24d1b46ef8f41cb98923762e8' }),
    )
  })

  it('does not load analytics outside production', () => {
    initializeAnalytics(false)

    expect(document.querySelector(beaconSelector)).toBeNull()
  })

  it('does not add the beacon more than once', () => {
    initializeAnalytics(true)
    initializeAnalytics(true)

    expect(document.querySelectorAll(beaconSelector)).toHaveLength(1)
  })
})
