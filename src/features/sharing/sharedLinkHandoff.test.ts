import { describe, expect, it } from 'vitest'
import { buildLiveActivityUrl } from '../liveSharing/liveActivityLink'
import { extractLiveActivityHash } from './sharedLinkHandoff'

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
})
