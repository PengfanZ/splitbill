import { describe, expect, it, vi } from 'vitest'
import {
  markRatingPromptHandled,
  RATING_PROMPT_STORAGE_KEY,
  shouldShowRatingPrompt,
} from './ratingPromptStorage'

describe('rating prompt persistence', () => {
  it('shows once for each release', () => {
    const storage = { getItem: vi.fn().mockReturnValue('older-release') }
    expect(shouldShowRatingPrompt('current-release', storage)).toBe(true)
    storage.getItem.mockReturnValue('current-release')
    expect(shouldShowRatingPrompt('current-release', storage)).toBe(false)
    expect(storage.getItem).toHaveBeenCalledWith(RATING_PROMPT_STORAGE_KEY)
  })

  it('fails open when storage cannot be read', () => {
    expect(shouldShowRatingPrompt('release', {
      getItem: vi.fn(() => { throw new Error('blocked') }),
    })).toBe(true)
  })

  it('marks a release handled without letting storage failures interrupt the app', () => {
    const storage = { setItem: vi.fn() }
    markRatingPromptHandled('current-release', storage)
    expect(storage.setItem).toHaveBeenCalledWith(RATING_PROMPT_STORAGE_KEY, 'current-release')
    expect(() => markRatingPromptHandled('release', {
      setItem: vi.fn(() => { throw new Error('blocked') }),
    })).not.toThrow()
  })
})
