import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { LocalizationProvider } from '../../i18n/LocalizationContext'
import { ThemeProvider } from '../../theme/ThemeContext'
import { THEME_STORAGE_KEY } from '../../theme/theme'
import { ThemeControl } from './ThemeControl'

describe('ThemeControl', () => {
  it('offers consistent localized theme choices and persists the selection', async () => {
    const user = userEvent.setup()
    render(
      <ThemeProvider initialPreference="system">
        <LocalizationProvider initialLocale="en"><ThemeControl /></LocalizationProvider>
      </ThemeProvider>,
    )

    expect(screen.getByRole('radiogroup', { name: 'Choose appearance' })).toBeVisible()
    expect(screen.getByRole('radio', { name: 'System' })).toBeChecked()
    await user.click(screen.getByRole('radio', { name: 'Dark' }))
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeChecked()
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
  })

  it('renders Simplified Chinese labels', () => {
    render(
      <ThemeProvider initialPreference="light">
        <LocalizationProvider initialLocale="zh-CN"><ThemeControl /></LocalizationProvider>
      </ThemeProvider>,
    )
    expect(screen.getByRole('radiogroup', { name: '选择外观' })).toBeVisible()
    expect(screen.getByRole('radio', { name: '浅色' })).toBeChecked()
    expect(screen.getByText('“跟随系统”会自动使用设备的外观设置。')).toBeVisible()
  })
})
