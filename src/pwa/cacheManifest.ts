export type PrecacheEntry = string | { revision?: string | null, url: string }

const CACHE_PREFIX = 'tally-shell-'

export function resolvePrecacheUrls(entries: PrecacheEntry[], baseUrl: string): string[] {
  return [...new Set(entries.map(entry => new URL(typeof entry === 'string' ? entry : entry.url, baseUrl).href))]
}

export function createCacheName(entries: PrecacheEntry[]): string {
  const serialized = JSON.stringify(entries)
  let hash = 2166136261
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `${CACHE_PREFIX}${(hash >>> 0).toString(36)}`
}

export function isTallyCache(cacheName: string): boolean {
  return cacheName.startsWith(CACHE_PREFIX)
}
