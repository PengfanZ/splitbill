import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SUPABASE_CONNECT_ORIGIN,
  DEVELOPMENT_CONNECT_SOURCES,
  resolveConnectSources,
  resolveSupabaseConnectOrigin,
} from './contentSecurityPolicy'

describe('content security policy', () => {
  it('allows only Google measurement endpoints when explicitly enabled', () => {
    expect(resolveConnectSources(undefined, false, true)).toBe([
      DEFAULT_SUPABASE_CONNECT_ORIGIN,
      'https://*.google-analytics.com', 'https://*.analytics.google.com', 'https://www.googletagmanager.com',
    ].join(' '))
    expect(resolveConnectSources()).not.toContain('google')
    expect(resolveConnectSources(undefined, false, true)).not.toMatch(/doubleclick|googleadservices|unsafe/)
  })
  it('uses the configured HTTPS origin without paths or trailing slashes', () => {
    expect(resolveSupabaseConnectOrigin(' https://preview.supabase.co/rest/v1/ '))
      .toBe('https://preview.supabase.co')
    expect(resolveSupabaseConnectOrigin('https://api.example.com/path'))
      .toBe('https://api.example.com')
  })

  it.each([
    undefined,
    '',
    'not-a-url',
    'http://preview.supabase.co',
    'javascript:alert(1)',
    'https://user:password@preview.supabase.co',
  ])('falls back to the production origin for an unsafe value: %s', value => {
    expect(resolveSupabaseConnectOrigin(value)).toBe(DEFAULT_SUPABASE_CONNECT_ORIGIN)
  })

  it('keeps local and test endpoints out of production builds', () => {
    expect(resolveConnectSources('https://preview.supabase.co')).toBe('https://preview.supabase.co')
    expect(resolveConnectSources('https://preview.supabase.co')).not.toMatch(/localhost|127\.0\.0\.1|live-sharing\.test/)
  })

  it('adds explicit browser-test and local endpoints only in development', () => {
    expect(resolveConnectSources('https://preview.supabase.co', true))
      .toBe(['https://preview.supabase.co', ...DEVELOPMENT_CONNECT_SOURCES].join(' '))
  })
})
