import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ThemeProvider, useTheme } from './ThemeContext'
import { THEME_MEDIA_QUERY, THEME_STORAGE_KEY } from './theme'

function Harness() {
  const { preference, resolvedTheme, setPreference } = useTheme()
  return <>
    <output aria-label="preference">{preference}</output>
    <output aria-label="resolved-theme">{resolvedTheme}</output>
    <button onClick={() => setPreference('light')}>Use light</button>
    <button onClick={() => setPreference('system')}>Use system</button>
  </>
}

function mediaQueryController(initialMatches: boolean) {
  let listener: ((event: MediaQueryListEvent) => void) | null = null
  const mediaQuery = {
    matches: initialMatches,
    media: THEME_MEDIA_QUERY,
    addEventListener: vi.fn((_event: string, nextListener: (event: MediaQueryListEvent) => void) => { listener = nextListener }),
    removeEventListener: vi.fn((_event: string, nextListener: (event: MediaQueryListEvent) => void) => {
      if (listener === nextListener) listener = null
    }),
  } as unknown as MediaQueryList
  return {
    matchMedia: vi.fn(() => mediaQuery),
    mediaQuery,
    emit(matches: boolean) { listener?.({ matches } as MediaQueryListEvent) },
  }
}

describe('ThemeProvider', () => {
  it('provides a harmless light-system fallback outside the provider', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    expect(screen.getByLabelText('preference')).toHaveTextContent('system')
    expect(screen.getByLabelText('resolved-theme')).toHaveTextContent('light')
    await user.click(screen.getByRole('button', { name: 'Use light' }))
  })

  it('follows live system changes and cleans up its listener', () => {
    const controller = mediaQueryController(true)
    vi.stubGlobal('matchMedia', controller.matchMedia)
    const { unmount } = render(<ThemeProvider initialPreference="system"><Harness /></ThemeProvider>)

    expect(screen.getByLabelText('resolved-theme')).toHaveTextContent('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(controller.mediaQuery.addEventListener).toHaveBeenCalledOnce()
    act(() => controller.emit(false))
    expect(screen.getByLabelText('resolved-theme')).toHaveTextContent('light')
    expect(document.documentElement.style.colorScheme).toBe('light')

    unmount()
    expect(controller.mediaQuery.removeEventListener).toHaveBeenCalledOnce()
    vi.unstubAllGlobals()
  })

  it('persists an override and reconnects to system changes when requested', async () => {
    const user = userEvent.setup()
    const controller = mediaQueryController(true)
    vi.stubGlobal('matchMedia', controller.matchMedia)
    render(<ThemeProvider><Harness /></ThemeProvider>)

    await user.click(screen.getByRole('button', { name: 'Use light' }))
    expect(screen.getByLabelText('preference')).toHaveTextContent('light')
    expect(screen.getByLabelText('resolved-theme')).toHaveTextContent('light')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
    expect(controller.mediaQuery.removeEventListener).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: 'Use system' }))
    expect(screen.getByLabelText('resolved-theme')).toHaveTextContent('dark')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('system')
    vi.unstubAllGlobals()
  })

  it('keeps system and explicit preferences usable without matchMedia', () => {
    vi.stubGlobal('matchMedia', undefined)
    const { unmount } = render(<ThemeProvider initialPreference="system"><Harness /></ThemeProvider>)
    expect(screen.getByLabelText('resolved-theme')).toHaveTextContent('light')
    unmount()
    render(<ThemeProvider initialPreference="dark"><Harness /></ThemeProvider>)
    expect(screen.getByLabelText('resolved-theme')).toHaveTextContent('dark')
    vi.unstubAllGlobals()
  })
})
