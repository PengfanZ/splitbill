export const THEME_STORAGE_KEY = 'tally:theme:v1'
export const THEME_MEDIA_QUERY = '(prefers-color-scheme: dark)'

export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = Exclude<ThemePreference, 'system'>

const THEME_COLORS: Record<ResolvedTheme, string> = {
  light: '#f7f4ee',
  dark: '#151513',
}

export function isThemePreference(value: string | null): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark'
}

export function loadThemePreference(storage: Pick<Storage, 'getItem'> = localStorage): ThemePreference {
  try {
    const stored = storage.getItem(THEME_STORAGE_KEY)
    return isThemePreference(stored) ? stored : 'system'
  } catch {
    return 'system'
  }
}

export function saveThemePreference(preference: ThemePreference, storage: Pick<Storage, 'setItem'> = localStorage) {
  try {
    storage.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    // Theme switching should still work when browser storage is unavailable.
  }
}

export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (preference !== 'system') return preference
  return systemPrefersDark ? 'dark' : 'light'
}

export function getSystemThemePreference(matchMedia: typeof window.matchMedia | null = window.matchMedia ?? null): boolean {
  return matchMedia?.(THEME_MEDIA_QUERY).matches ?? false
}

export function applyResolvedTheme(theme: ResolvedTheme, root = document.documentElement, themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')) {
  root.dataset.theme = theme
  root.style.colorScheme = theme
  if (themeColor) themeColor.content = THEME_COLORS[theme]
}
