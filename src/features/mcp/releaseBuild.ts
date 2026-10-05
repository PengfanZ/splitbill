import { DEFAULT_SUPABASE_CONNECT_ORIGIN } from '../../security/contentSecurityPolicy'

/**
 * A published tally-splitbill-mcp talks to whatever backend it was built with, so a release must use production.
 * A local `.env.local` may point at a preview project. Messages never repeat the values.
 */
export function assertReleaseBackend(environment: { VITE_SUPABASE_URL?: string; VITE_SUPABASE_PUBLISHABLE_KEY?: string }) {
  let origin = ''
  try {
    origin = new URL(environment.VITE_SUPABASE_URL ?? '').origin
  } catch {
    // Reported below.
  }
  if (origin !== DEFAULT_SUPABASE_CONNECT_ORIGIN) {
    throw new Error('A tally-splitbill-mcp release must be built for the production backend. Set VITE_SUPABASE_URL to production; .env.local may point at a preview project.')
  }
  if (!environment.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()) {
    throw new Error('A tally-splitbill-mcp release needs VITE_SUPABASE_PUBLISHABLE_KEY for the production backend.')
  }
}
