import { createLiveActivityClient } from './liveActivityApi'

export type LiveActivityClient = ReturnType<typeof createLiveActivityClient>

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
