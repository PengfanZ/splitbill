import { describe, expect, it, vi } from 'vitest'
import {
  applyResolvedTheme,
  getSystemThemePreference,
  isThemePreference,
  loadThemePreference,
  resolveTheme,
  saveThemePreference,
  THEME_MEDIA_QUERY,
  THEME_STORAGE_KEY,
} from './theme'

describe('theme preferences', () => {
  it.each(['system', 'light', 'dark'] as const)('accepts the supported %s preference', preference => {
    expect(isThemePreference(preference)).toBe(true)
  })

  it('rejects missing and unsupported preferences', () => {
    expect(isThemePreference(null)).toBe(false)
    expect(isThemePreference('midnight')).toBe(false)
  })

  it('loads valid preferences and falls back safely', () => {
    expect(loadThemePreference({ getItem: () => 'dark' })).toBe('dark')
    expect(loadThemePreference({ getItem: () => 'unknown' })).toBe('system')
    expect(loadThemePreference({ getItem: () => { throw new Error('blocked') } })).toBe('system')
  })

  it('saves preferences without making storage availability a requirement', () => {
    const setItem = vi.fn()
    saveThemePreference('light', { setItem })
    expect(setItem).toHaveBeenCalledWith(THEME_STORAGE_KEY, 'light')
    expect(() => saveThemePreference('dark', { setItem: () => { throw new Error('blocked') } })).not.toThrow()
  })

  it('resolves explicit preferences before the system preference', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })

  it('reads the system media query and handles older browsers', () => {
    const matchMedia = vi.fn(() => ({ matches: true }) as MediaQueryList)
    expect(getSystemThemePreference(matchMedia)).toBe(true)
    expect(matchMedia).toHaveBeenCalledWith(THEME_MEDIA_QUERY)
    expect(getSystemThemePreference(null)).toBe(false)
  })

  it('applies the resolved theme to document surfaces', () => {
    const root = document.createElement('html')
    const themeColor = document.createElement('meta')
    applyResolvedTheme('dark', root, themeColor)
    expect(root.dataset.theme).toBe('dark')
    expect(root.style.colorScheme).toBe('dark')
    expect(themeColor.content).toBe('#151513')

    applyResolvedTheme('light', root, null)
    expect(root.dataset.theme).toBe('light')
    expect(root.style.colorScheme).toBe('light')
  })
})
