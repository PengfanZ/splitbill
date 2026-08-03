import { describe, expect, it } from 'vitest'
import {
  createCacheName,
  isTallyCache,
  resolveAppShellUrl,
  resolvePrecacheUrls,
  type PrecacheEntry,
} from './cacheManifest'

describe('service-worker cache manifest helpers', () => {
  const entries: PrecacheEntry[] = [
    { url: 'index.html', revision: 'first' },
    'assets/app.js',
    { url: 'index.html', revision: 'duplicate' },
  ]

  it('uses the canonical scope URL for the app shell and removes duplicate URLs', () => {
    expect(resolvePrecacheUrls(entries, 'https://example.com/splitbill/sw.js')).toEqual([
      'https://example.com/splitbill/',
      'https://example.com/splitbill/assets/app.js',
    ])
  })

  it('resolves root and nested app-shell URLs without requesting index.html', () => {
    expect(resolveAppShellUrl('https://example.com/sw.js')).toBe('https://example.com/')
    expect(resolveAppShellUrl('https://example.com/splitbill/sw.js')).toBe('https://example.com/splitbill/')
  })

  it('does not rewrite a same-named index file from another origin', () => {
    expect(resolvePrecacheUrls(
      ['https://assets.example.com/splitbill/index.html'],
      'https://example.com/splitbill/sw.js',
    )).toEqual(['https://assets.example.com/splitbill/index.html'])
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
