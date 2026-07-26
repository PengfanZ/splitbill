import { describe, expect, it, vi } from 'vitest'
import {
  CHANGELOG_ENTRIES,
  CHANGELOG_SEEN_STORAGE_KEY,
  formatChangelogDate,
  hasSeenLatestChangelog,
  LATEST_CHANGELOG_ID,
  markLatestChangelogSeen,
} from './changelog'

function storageWith(value: string | null = null): Storage {
  return {
    length: value === null ? 0 : 1,
    clear: vi.fn(),
    getItem: vi.fn().mockReturnValue(value),
    key: vi.fn().mockReturnValue(value === null ? null : CHANGELOG_SEEN_STORAGE_KEY),
    removeItem: vi.fn(),
    setItem: vi.fn(),
  }
}

describe('changelog', () => {
  it('keeps the latest release first and gives every item a stable localized shape', () => {
    expect(LATEST_CHANGELOG_ID).toBe(CHANGELOG_ENTRIES[0].id)
    expect(CHANGELOG_ENTRIES[0]).toMatchObject({
      releasedOn: '2026-07-26',
      items: [
        { icon: 'live' },
        { icon: 'share' },
        { icon: 'settle' },
        { icon: 'polish' },
      ],
    })
  })

  it('formats release dates for both supported languages without a timezone shift', () => {
    expect(formatChangelogDate('2026-07-26', 'en')).toBe('July 26, 2026')
    expect(formatChangelogDate('2026-07-26', 'zh-CN')).toBe('2026年7月26日')
  })

  it('reads and writes the latest seen release defensively', () => {
    const unseen = storageWith()
    const seen = storageWith(LATEST_CHANGELOG_ID)
    expect(hasSeenLatestChangelog(unseen)).toBe(false)
    expect(hasSeenLatestChangelog(seen)).toBe(true)

    markLatestChangelogSeen(unseen)
    expect(unseen.setItem).toHaveBeenCalledWith(CHANGELOG_SEEN_STORAGE_KEY, LATEST_CHANGELOG_ID)

    const blocked = storageWith()
    vi.mocked(blocked.getItem).mockImplementation(() => { throw new Error('blocked') })
    vi.mocked(blocked.setItem).mockImplementation(() => { throw new Error('blocked') })
    expect(hasSeenLatestChangelog(blocked)).toBe(false)
    expect(() => markLatestChangelogSeen(blocked)).not.toThrow()
  })
})
