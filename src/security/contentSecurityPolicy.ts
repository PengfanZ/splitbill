export const DEFAULT_SUPABASE_CONNECT_ORIGIN = 'https://khneqfwvlspwfzdzpsyg.supabase.co'
export const DEVELOPMENT_CONNECT_SOURCES = [
  'https://live-sharing.test',
  'http://127.0.0.1:*',
  'http://localhost:*',
  'ws://127.0.0.1:*',
  'ws://localhost:*',
] as const

export function resolveSupabaseConnectOrigin(value?: string) {
  const candidate = value?.trim()
  if (!candidate) return DEFAULT_SUPABASE_CONNECT_ORIGIN

  try {
    const url = new URL(candidate)
    if (url.protocol !== 'https:' || url.username || url.password) {
      return DEFAULT_SUPABASE_CONNECT_ORIGIN
    }
    return url.origin
  } catch {
    return DEFAULT_SUPABASE_CONNECT_ORIGIN
  }
}

export function resolveConnectSources(value?: string, development = false) {
  return [
    resolveSupabaseConnectOrigin(value),
    ...(development ? DEVELOPMENT_CONNECT_SOURCES : []),
  ].join(' ')
}
