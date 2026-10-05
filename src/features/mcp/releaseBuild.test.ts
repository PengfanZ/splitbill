import { describe, expect, it } from 'vitest'
import { DEFAULT_SUPABASE_CONNECT_ORIGIN } from '../../security/contentSecurityPolicy'
import { assertReleaseBackend } from './releaseBuild'

describe('assertReleaseBackend', () => {
  it('accepts the production backend with a publishable key', () => {
    expect(() => assertReleaseBackend({ VITE_SUPABASE_URL: `${DEFAULT_SUPABASE_CONNECT_ORIGIN}/`, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' })).not.toThrow()
  })

  it('refuses preview, local and missing backends without printing them', () => {
    for (const url of ['https://previewprojectref00000.supabase.co', 'http://127.0.0.1:54321', 'not a url', undefined]) {
      expect(() => assertReleaseBackend({ VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' }))
        .toThrow('must be built for the production backend')
    }
    try {
      assertReleaseBackend({ VITE_SUPABASE_URL: 'https://previewprojectref00000.supabase.co' })
    } catch (error) {
      expect((error as Error).message).not.toContain('previewprojectref00000')
    }
  })

  it('refuses a production build without a publishable key', () => {
    expect(() => assertReleaseBackend({ VITE_SUPABASE_URL: DEFAULT_SUPABASE_CONNECT_ORIGIN, VITE_SUPABASE_PUBLISHABLE_KEY: ' ' })).toThrow('VITE_SUPABASE_PUBLISHABLE_KEY')
  })
})
