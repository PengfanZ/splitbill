import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { LocalizationProvider } from '../../i18n/LocalizationContext'
import { ChangelogModal } from './ChangelogModal'

describe('ChangelogModal', () => {
  it('shows the latest English update and closes from either action', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<LocalizationProvider initialLocale="en"><ChangelogModal onClose={onClose} /></LocalizationProvider>)

    const dialog = screen.getByRole('dialog', { name: 'What’s new in Tally' })
    expect(dialog).toHaveTextContent('July 26, 2026')
    expect(dialog).toHaveTextContent('Sharing, without the guesswork')
    expect(screen.getByText('Reliable live collaboration')).toBeVisible()
    expect(screen.getByText('Clear sharing choices')).toBeVisible()
    expect(screen.getByText('Settle up together')).toBeVisible()
    expect(screen.getByText('Polish where it matters')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Got it' }))
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('renders the same update naturally in Simplified Chinese', () => {
    render(<LocalizationProvider initialLocale="zh-CN"><ChangelogModal onClose={vi.fn()} /></LocalizationProvider>)
    const dialog = screen.getByRole('dialog', { name: 'Tally 最近更新' })
    expect(dialog).toHaveTextContent('2026年7月26日')
    expect(dialog).toHaveTextContent('分享更清楚，也更安心')
    expect(screen.getByText('更可靠的实时协作')).toBeVisible()
    expect(screen.getByRole('button', { name: '知道了' })).toBeVisible()
  })
})
