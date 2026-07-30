import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { LocalizationProvider } from '../../i18n/LocalizationContext'
import { LanguageControl } from './LanguageControl'

function renderControl(onChange = vi.fn()) {
  return {
    onChange,
    ...render(
      <LocalizationProvider initialLocale="en">
        <LanguageControl locale="en" onChange={onChange} />
      </LocalizationProvider>,
    ),
  }
}

describe('LanguageControl', () => {
  it('opens a localized menu, marks the current language, and selects another one', async () => {
    const user = userEvent.setup()
    const { onChange } = renderControl()
    const trigger = screen.getByRole('button', { name: 'Language, English' })

    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('listbox', { name: 'Choose language' })).toBeVisible()
    expect(screen.getByRole('option', { name: 'English' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('option', { name: '简体中文' })).toHaveAttribute('aria-selected', 'false')

    await user.click(screen.getByRole('option', { name: '简体中文' }))
    expect(onChange).toHaveBeenCalledWith('zh-CN')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('toggles, closes outside, and supports Escape without reacting to other keys', async () => {
    const user = userEvent.setup()
    renderControl()
    const trigger = screen.getByRole('button', { name: 'Language, English' })

    await user.click(trigger)
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    expect(screen.getByRole('listbox')).toBeVisible()
    fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()

    await user.click(trigger)
    await user.click(trigger)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()

    await user.click(trigger)
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
