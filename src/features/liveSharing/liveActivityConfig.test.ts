import { describe, expect, it } from 'vitest'
import { createConfiguredLiveActivityClient } from './liveActivityConfig'

describe('live activity environment configuration', () => {
  it.each([
    {},
    { VITE_SUPABASE_URL: '   ', VITE_SUPABASE_PUBLISHABLE_KEY: 'key' },
    { VITE_SUPABASE_URL: 'https://project.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: '   ' },
  ])('disables live sharing unless both settings exist: %j', environment => {
    expect(createConfiguredLiveActivityClient(environment)).toBeNull()
  })

  it('creates a client from trimmed settings', () => {
    expect(createConfiguredLiveActivityClient({
      VITE_SUPABASE_URL: ' https://project.supabase.co ',
      VITE_SUPABASE_PUBLISHABLE_KEY: ' key ',
    })).toMatchObject({ create: expect.any(Function), load: expect.any(Function), update: expect.any(Function) })
  })
})
