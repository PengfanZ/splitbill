import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isStandalonePwa } from './displayMode'

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn().mockReturnValue({ matches: false }) })
  Object.defineProperty(navigator, 'standalone', { configurable: true, value: false })
})

describe('PWA display mode', () => {
  it('recognizes standards-based and iOS standalone modes', () => {
    expect(isStandalonePwa()).toBe(false)
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList)
    expect(isStandalonePwa()).toBe(true)
    vi.mocked(window.matchMedia).mockReturnValue({ matches: false } as MediaQueryList)
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true })
    expect(isStandalonePwa()).toBe(true)
  })
})
