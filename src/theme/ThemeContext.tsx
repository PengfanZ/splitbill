import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  applyResolvedTheme,
  getSystemThemePreference,
  loadThemePreference,
  resolveTheme,
  saveThemePreference,
  THEME_MEDIA_QUERY,
  type ResolvedTheme,
  type ThemePreference,
} from './theme'

type ThemeValue = {
  preference: ThemePreference
  resolvedTheme: ResolvedTheme
  setPreference: (preference: ThemePreference) => void
}

const ThemeContext = createContext<ThemeValue>({
  preference: 'system',
  resolvedTheme: 'light',
  setPreference: () => {},
})

export function ThemeProvider({ children, initialPreference }: { children: ReactNode; initialPreference?: ThemePreference }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => initialPreference ?? loadThemePreference())
  const [systemPrefersDark, setSystemPrefersDark] = useState(getSystemThemePreference)
  const resolvedTheme = resolveTheme(preference, systemPrefersDark)

  const setPreference = useCallback((nextPreference: ThemePreference) => {
    if (nextPreference === 'system') setSystemPrefersDark(getSystemThemePreference())
    setPreferenceState(nextPreference)
    saveThemePreference(nextPreference)
  }, [])

  useEffect(() => {
    applyResolvedTheme(resolvedTheme)
  }, [resolvedTheme])

  useEffect(() => {
    if (preference !== 'system') return
    const mediaQuery = window.matchMedia?.(THEME_MEDIA_QUERY)
    if (!mediaQuery) return
    const updateSystemTheme = (event: MediaQueryListEvent) => setSystemPrefersDark(event.matches)
    mediaQuery.addEventListener('change', updateSystemTheme)
    return () => mediaQuery.removeEventListener('change', updateSystemTheme)
  }, [preference])

  const value = useMemo(() => ({ preference, resolvedTheme, setPreference }), [preference, resolvedTheme, setPreference])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  return useContext(ThemeContext)
}
