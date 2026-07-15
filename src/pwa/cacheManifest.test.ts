import { describe, expect, it } from 'vitest'
import { createCacheName, isTallyCache, resolvePrecacheUrls, type PrecacheEntry } from './cacheManifest'

describe('service-worker cache manifest helpers', () => {
  const entries: PrecacheEntry[] = [
    { url: 'index.html', revision: 'first' },
    'assets/app.js',
    { url: 'index.html', revision: 'duplicate' },
  ]

  it('resolves relative entries against the worker scope and removes duplicate URLs', () => {
    expect(resolvePrecacheUrls(entries, 'https://example.com/splitbill/sw.js')).toEqual([
      'https://example.com/splitbill/index.html',
      'https://example.com/splitbill/assets/app.js',
    ])
  })

  it('creates a stable versioned name that changes with the precache manifest', () => {
    expect(createCacheName(entries)).toBe(createCacheName(entries))
    expect(createCacheName(entries)).not.toBe(createCacheName([{ url: 'index.html', revision: 'second' }]))
    expect(createCacheName([])).toMatch(/^tally-shell-/)
  })

  it('identifies only caches owned by Tally', () => {
    expect(isTallyCache(createCacheName(entries))).toBe(true)
    expect(isTallyCache('another-app-cache')).toBe(false)
  })
})
