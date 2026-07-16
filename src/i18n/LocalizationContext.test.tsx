import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { LocalizationProvider, useLocalization } from './LocalizationContext'
import { LOCALE_STORAGE_KEY } from './localization'

function Harness() {
  const { locale, setLocale, t, timeZone, formatDateTime } = useLocalization()
  return <>
    <output aria-label="locale">{locale}</output>
    <output aria-label="translation">{t('topbar.settings')}</output>
    <output aria-label="time-zone">{timeZone}</output>
    <output aria-label="date">{formatDateTime('2026-07-16T12:30:00.000Z')}</output>
    <button onClick={() => setLocale('zh-CN')}>Chinese</button>
    <button onClick={() => setLocale('en')}>English</button>
  </>
}

describe('LocalizationProvider', () => {
  it('provides English fallback values without a provider', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    expect(screen.getByLabelText('locale')).toHaveTextContent('en')
    expect(screen.getByLabelText('translation')).toHaveTextContent('Settings')
    expect(screen.getByLabelText('time-zone')).not.toBeEmptyDOMElement()
    expect(screen.getByLabelText('date')).not.toBeEmptyDOMElement()
    await user.click(screen.getByRole('button', { name: 'Chinese' }))
  })

  it('switches immediately, persists the choice, and updates document metadata', async () => {
    const user = userEvent.setup()
    const setItem = vi.spyOn(localStorage, 'setItem')
    render(<LocalizationProvider initialLocale="en"><Harness /></LocalizationProvider>)
    expect(document.documentElement.lang).toBe('en')
    expect(document.title).toBe('Tally — Group Expense Splitter')

    await user.click(screen.getByRole('button', { name: 'Chinese' }))
    expect(screen.getByLabelText('locale')).toHaveTextContent('zh-CN')
    expect(screen.getByLabelText('translation')).toHaveTextContent('设置')
    expect(document.documentElement.lang).toBe('zh-CN')
    expect(document.title).toBe('Tally — 多人分账工具')
    expect(setItem).toHaveBeenCalledWith(LOCALE_STORAGE_KEY, 'zh-CN')

    await user.click(screen.getByRole('button', { name: 'English' }))
    expect(screen.getByLabelText('locale')).toHaveTextContent('en')
  })
})
