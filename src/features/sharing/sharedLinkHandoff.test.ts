import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildLiveActivityUrl } from '../liveSharing/liveActivityLink'
import { extractLiveActivityHash, isStandalonePwa } from './sharedLinkHandoff'

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn().mockReturnValue({ matches: false }) })
  Object.defineProperty(navigator, 'standalone', { configurable: true, value: false })
})

describe('Live link PWA handoff', () => {
  it('extracts a valid Live fragment without navigating away from the app', () => {
    const credentials = { code: 'A1B2C3D4E5', editToken: 'a'.repeat(64) }
    const liveUrl = buildLiveActivityUrl(credentials, 'https://pengfanz.github.io/splitbill/')

    expect(extractLiveActivityHash(liveUrl)).toBe(new URL(liveUrl).hash)
    expect(extractLiveActivityHash(new URL(liveUrl).hash)).toBe(new URL(liveUrl).hash)
  })

  it('rejects empty, malformed, and unrelated links', () => {
    expect(extractLiveActivityHash('')).toBeNull()
    expect(extractLiveActivityHash('not a URL', 'not a base')).toBeNull()
    expect(extractLiveActivityHash('https://example.com/#other=value')).toBeNull()
    expect(extractLiveActivityHash('https://example.com/#share=legacy')).toBeNull()
    expect(extractLiveActivityHash('https://example.com/#live=broken')).toBeNull()
  })

  it('recognizes standards-based and iOS standalone display modes', () => {
    expect(isStandalonePwa()).toBe(false)
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList)
    expect(isStandalonePwa()).toBe(true)
    vi.mocked(window.matchMedia).mockReturnValue({ matches: false } as MediaQueryList)
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true })
    expect(isStandalonePwa()).toBe(true)
  })
})
