export const DEFAULT_SUPABASE_CONNECT_ORIGIN = 'https://khneqfwvlspwfzdzpsyg.supabase.co'

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
