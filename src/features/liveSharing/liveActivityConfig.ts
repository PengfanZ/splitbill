import { createLiveActivityClient } from './liveActivityApi'

type ConfiguredLiveActivityClient = ReturnType<typeof createLiveActivityClient>

// Keep injected preview/test clients created before revocation support usable.
// Configured production clients always include `end`.
export type LiveActivityClient = Omit<ConfiguredLiveActivityClient, 'end'>
  & Partial<Pick<ConfiguredLiveActivityClient, 'end'>>

type LiveActivityEnvironment = {
  VITE_SUPABASE_URL?: string
  VITE_SUPABASE_PUBLISHABLE_KEY?: string
}

export function createConfiguredLiveActivityClient(environment: LiveActivityEnvironment = import.meta.env as LiveActivityEnvironment): LiveActivityClient | null {
  const supabaseUrl = environment.VITE_SUPABASE_URL?.trim() ?? ''
  const publishableKey = environment.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? ''
  return supabaseUrl && publishableKey
    ? createLiveActivityClient({ supabaseUrl, publishableKey })
    : null
}
