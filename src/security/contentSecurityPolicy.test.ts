import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SUPABASE_CONNECT_ORIGIN,
  resolveSupabaseConnectOrigin,
} from './contentSecurityPolicy'

describe('content security policy', () => {
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
})
