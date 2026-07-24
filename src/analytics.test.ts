import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ANALYTICS_SESSION_KEY,
  createConfiguredAnalyticsClient,
  getOrCreateAnalyticsSessionToken,
  initializeAnalytics,
} from './analytics'

const beaconSelector =
  'script[src="https://static.cloudflareinsights.com/beacon.min.js"]'

function deterministicCrypto(byte = 0xab) {
  return {
    getRandomValues: vi.fn((array: Uint8Array) => {
      array.fill(byte)
      return array
    }),
  } as unknown as Crypto
}

beforeEach(() => {
  vi.unstubAllEnvs()
  document.body.innerHTML = ''
  window.history.replaceState(null, '', '/')
  sessionStorage.clear()
})

describe('first-party analytics', () => {
  it('reuses a valid session token without generating a persistent visitor identifier', () => {
    const cryptoProvider = deterministicCrypto()
    sessionStorage.setItem(ANALYTICS_SESSION_KEY, '0123456789abcdef0123456789abcdef')

    expect(getOrCreateAnalyticsSessionToken(sessionStorage, cryptoProvider)).toBe('0123456789abcdef0123456789abcdef')
    expect(cryptoProvider.getRandomValues).not.toHaveBeenCalled()
  })

  it('replaces invalid session data with a random session-scoped token', () => {
    sessionStorage.setItem(ANALYTICS_SESSION_KEY, 'not-a-valid-token')

    expect(getOrCreateAnalyticsSessionToken(sessionStorage, deterministicCrypto(1))).toBe('01'.repeat(16))
    expect(sessionStorage.getItem(ANALYTICS_SESSION_KEY)).toBe('01'.repeat(16))
  })

  it('keeps working when session storage is unavailable', () => {
    const blockedStorage = {
      getItem: vi.fn(() => { throw new Error('blocked') }),
      setItem: vi.fn(() => { throw new Error('blocked') }),
    } as unknown as Storage

    expect(getOrCreateAnalyticsSessionToken(blockedStorage, deterministicCrypto(2))).toBe('02'.repeat(16))
    expect(getOrCreateAnalyticsSessionToken(null, deterministicCrypto(3))).toBe('03'.repeat(16))
  })

  it.each([
    [{}, true],
    [{ VITE_SUPABASE_URL: 'https://project.supabase.co' }, true],
    [{ VITE_SUPABASE_PUBLISHABLE_KEY: 'key' }, true],
    [{ VITE_SUPABASE_URL: 'not a URL', VITE_SUPABASE_PUBLISHABLE_KEY: 'key' }, true],
    [{ VITE_SUPABASE_URL: 'http://example.com', VITE_SUPABASE_PUBLISHABLE_KEY: 'key' }, true],
    [{ VITE_SUPABASE_URL: 'https://project.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'key' }, false],
  ])('disables first-party analytics for incomplete or unsafe configuration: %j', (environment, enabled) => {
    expect(createConfiguredAnalyticsClient(environment, { enabled })).toBeNull()
  })

  it.each([
    'https://project.supabase.co',
    'http://localhost:54321',
    'http://127.0.0.1:54321',
    'http://[::1]:54321',
  ])('accepts a secure or loopback Supabase URL: %s', url => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    const client = createConfiguredAnalyticsClient({
      VITE_SUPABASE_URL: ` ${url} `,
      VITE_SUPABASE_PUBLISHABLE_KEY: ' key ',
    }, {
      enabled: true,
      fetcher,
      storage: null,
      crypto: deterministicCrypto(),
    })

    expect(client).not.toBeNull()
  })

  it('posts only an allowlisted event, surface, and session token', () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    const client = createConfiguredAnalyticsClient({
      VITE_SUPABASE_URL: ' https://project.supabase.co/ ',
      VITE_SUPABASE_PUBLISHABLE_KEY: ' publishable-key ',
    }, {
      enabled: true,
      fetcher,
      crypto: deterministicCrypto(4),
    })!

    client.track('expense_added', 'local', 'zh-CN')

    expect(fetcher).toHaveBeenCalledWith(
      'https://project.supabase.co/rest/v1/rpc/record_analytics_event',
      expect.objectContaining({
        method: 'POST',
        cache: 'no-store',
        credentials: 'omit',
        keepalive: true,
        referrerPolicy: 'no-referrer',
        headers: {
          apikey: 'publishable-key',
          authorization: 'Bearer publishable-key',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          p_event_name: 'expense_added',
          p_surface: 'local',
          p_session_token: '04'.repeat(16),
          p_locale: 'zh-CN',
          p_currency: null,
        }),
      }),
    )
    expect(sessionStorage.getItem(ANALYTICS_SESSION_KEY)).toBe('04'.repeat(16))
  })

  it('sends only the allowlisted currency code for a currency selection', () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    const client = createConfiguredAnalyticsClient({
      VITE_SUPABASE_URL: 'https://project.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
    }, {
      enabled: true,
      fetcher,
      storage: null,
      crypto: deterministicCrypto(5),
    })!

    client.track('currency_selected', 'live', 'en', 'CNY')

    expect(JSON.parse(fetcher.mock.calls[0][1].body as string)).toEqual({
      p_event_name: 'currency_selected',
      p_surface: 'live',
      p_session_token: '05'.repeat(16),
      p_locale: 'en',
      p_currency: 'CNY',
    })
  })

  it('uses browser fetch, crypto, and session storage by default', () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    Object.defineProperty(window, 'fetch', { configurable: true, value: fetcher })
    const client = createConfiguredAnalyticsClient({
      VITE_SUPABASE_URL: 'https://project.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'key',
    }, { enabled: true })!

    client.track('app_opened', 'snapshot', 'en')

    expect(fetcher).toHaveBeenCalledOnce()
    expect(sessionStorage.getItem(ANALYTICS_SESSION_KEY)).toMatch(/^[a-f0-9]{32}$/)
  })

  it('silently ignores asynchronous and synchronous analytics failures', () => {
    const rejectedClient = createConfiguredAnalyticsClient({
      VITE_SUPABASE_URL: 'https://project.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'key',
    }, {
      enabled: true,
      fetcher: vi.fn().mockRejectedValue(new Error('offline')),
      storage: null,
      crypto: deterministicCrypto(),
    })!
    const throwingClient = createConfiguredAnalyticsClient({
      VITE_SUPABASE_URL: 'https://project.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'key',
    }, {
      enabled: true,
      fetcher: vi.fn(() => { throw new Error('blocked') }),
      storage: null,
      crypto: deterministicCrypto(),
    })!

    expect(() => rejectedClient.track('app_opened', 'local', 'en')).not.toThrow()
    expect(() => throwingClient.track('app_opened', 'local', 'en')).not.toThrow()
  })

  it('fails closed when browser dependencies cannot create a session', () => {
    const brokenCrypto = {
      getRandomValues: vi.fn(() => { throw new Error('unavailable') }),
    } as unknown as Crypto
    expect(createConfiguredAnalyticsClient({
      VITE_SUPABASE_URL: 'https://project.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'key',
    }, {
      enabled: true,
      fetcher: vi.fn(),
      storage: null,
      crypto: brokenCrypto,
    })).toBeNull()
  })
})

describe('Cloudflare fallback analytics', () => {
  it('loads the deferred Cloudflare beacon for frontend-only production builds', () => {
    initializeAnalytics(true, false)

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

  it('does not load third-party analytics when first-party analytics is configured', () => {
    initializeAnalytics(true, true)

    expect(document.querySelector(beaconSelector)).toBeNull()
  })

  it('detects configured first-party analytics from the default environment', () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co')
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'key')

    initializeAnalytics(true)

    expect(document.querySelector(beaconSelector)).toBeNull()
  })

  it.each(['#share=private-state', '#live=PRIVATE-CAPABILITY'])('does not load third-party analytics for activity URL %s', hash => {
    window.history.replaceState(null, '', `/${hash}`)

    initializeAnalytics(true, false)

    expect(document.querySelector(beaconSelector)).toBeNull()
  })

  it('does not add the beacon more than once', () => {
    initializeAnalytics(true, false)
    initializeAnalytics(true, false)

    expect(document.querySelectorAll(beaconSelector)).toHaveLength(1)
  })
})
