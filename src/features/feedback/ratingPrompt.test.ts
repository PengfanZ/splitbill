import { describe, expect, it, vi } from 'vitest'
import {
  AI_RATING_PROMPT_STORAGE_KEY,
  markAiRatingPromptHandled,
  shouldShowAiRatingPrompt,
  CSV_EXPORT_RATING_PROMPT_STORAGE_KEY,
  markCsvExportRatingPromptHandled,
  markRatingPromptHandled,
  RATING_PROMPT_STORAGE_KEY,
  shouldShowCsvExportRatingPrompt,
  shouldShowRatingPrompt,
} from './ratingPromptStorage'

describe('first AI-use prompt storage', () => {
  it('persists independently of share and CSV prompts', () => {
    expect(shouldShowAiRatingPrompt()).toBe(true)
    markAiRatingPromptHandled()
    expect(localStorage.getItem(AI_RATING_PROMPT_STORAGE_KEY)).toBe('handled')
    expect(shouldShowAiRatingPrompt()).toBe(false)
    expect(shouldShowRatingPrompt('new-release')).toBe(true)
    expect(shouldShowCsvExportRatingPrompt()).toBe(true)
  })

  it('tolerates unavailable browser storage', () => {
    expect(shouldShowAiRatingPrompt({ getItem: () => { throw new Error('blocked') } })).toBe(true)
    expect(() => markAiRatingPromptHandled({ setItem: () => { throw new Error('blocked') } })).not.toThrow()
  })
})

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

  it('shows the CSV export prompt once per browser', () => {
    const storage = { getItem: vi.fn().mockReturnValue(null) }
    expect(shouldShowCsvExportRatingPrompt(storage)).toBe(true)
    storage.getItem.mockReturnValue('handled')
    expect(shouldShowCsvExportRatingPrompt(storage)).toBe(false)
    expect(storage.getItem).toHaveBeenCalledWith(CSV_EXPORT_RATING_PROMPT_STORAGE_KEY)
  })

  it('fails open when the CSV prompt state cannot be read', () => {
    expect(shouldShowCsvExportRatingPrompt({
      getItem: vi.fn(() => { throw new Error('blocked') }),
    })).toBe(true)
  })

  it('marks the CSV prompt handled without letting storage failures interrupt the export', () => {
    const storage = { setItem: vi.fn() }
    markCsvExportRatingPromptHandled(storage)
    expect(storage.setItem).toHaveBeenCalledWith(CSV_EXPORT_RATING_PROMPT_STORAGE_KEY, 'handled')
    expect(() => markCsvExportRatingPromptHandled({
      setItem: vi.fn(() => { throw new Error('blocked') }),
    })).not.toThrow()
  })
})
