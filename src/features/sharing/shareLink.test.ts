import { beforeEach, describe, expect, it, vi } from 'vitest'
import { copyLink, shareLink } from './shareLink'

beforeEach(() => {
  Object.defineProperty(navigator, 'share', { configurable: true, value: undefined })
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
})

describe('shared link delivery', () => {
  it('opens the native share sheet with the activity context', async () => {
    const nativeShare = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'share', { configurable: true, value: nativeShare })

    expect(await shareLink('Trip — Tally', 'https://example.com/#live=secret', 'Join Trip')).toBe('shared')
    expect(nativeShare).toHaveBeenCalledWith({ title: 'Trip — Tally', text: 'Join Trip', url: 'https://example.com/#live=secret' })
  })

  it('preserves cancellation instead of copying a link the user chose not to share', async () => {
    const writeText = vi.fn()
    Object.defineProperty(navigator, 'share', { configurable: true, value: vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError')) })
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })

    expect(await shareLink('Trip', 'https://example.com')).toBe('cancelled')
    expect(writeText).not.toHaveBeenCalled()
  })

  it('falls back to copying when native sharing is missing or fails', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    expect(await shareLink('Trip', 'https://example.com')).toBe('copied')

    Object.defineProperty(navigator, 'share', { configurable: true, value: vi.fn().mockRejectedValue(new Error('unavailable')) })
    expect(await shareLink('Trip', 'https://example.com')).toBe('copied')
    expect(writeText).toHaveBeenCalledTimes(2)
  })

  it('reports unavailable and rejected clipboard writes', async () => {
    expect(await copyLink('https://example.com')).toBe('failed')
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('blocked')) } })
    expect(await copyLink('https://example.com')).toBe('failed')
    expect(await shareLink('Trip', 'https://example.com')).toBe('failed')
  })
})
