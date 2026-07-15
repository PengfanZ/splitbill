import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CURRENT_USER } from '../../domain/members'
import type { ActivityGroup } from '../../domain/models'
import { buildLiveActivityUrl } from '../liveSharing/liveActivityLink'
import { buildSharedActivityUrl, createSharedActivity } from './shareActivityUrl'
import { extractSharedActivityHash, isStandalonePwa } from './sharedLinkHandoff'

const group: ActivityGroup = { id: 'trip', name: 'Trip', emoji: '✦', memberIds: ['me'] }

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn().mockReturnValue({ matches: false }) })
  Object.defineProperty(navigator, 'standalone', { configurable: true, value: false })
})

describe('shared link PWA handoff', () => {
  it('extracts valid live and snapshot fragments without navigating away from the app', () => {
    const credentials = { code: 'A1B2C3D4E5', editToken: 'a'.repeat(64) }
    const liveUrl = buildLiveActivityUrl(credentials, 'https://pengfanz.github.io/splitbill/')
    const snapshotUrl = buildSharedActivityUrl(createSharedActivity(group, [CURRENT_USER], []), 'https://pengfanz.github.io/splitbill/')

    expect(extractSharedActivityHash(liveUrl)).toBe(new URL(liveUrl).hash)
    expect(extractSharedActivityHash(new URL(snapshotUrl).hash)).toBe(new URL(snapshotUrl).hash)
  })

  it('rejects empty, malformed, and unrelated links', () => {
    expect(extractSharedActivityHash('')).toBeNull()
    expect(extractSharedActivityHash('not a URL', 'not a base')).toBeNull()
    expect(extractSharedActivityHash('https://example.com/#other=value')).toBeNull()
    expect(extractSharedActivityHash('https://example.com/#live=broken')).toBeNull()
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
