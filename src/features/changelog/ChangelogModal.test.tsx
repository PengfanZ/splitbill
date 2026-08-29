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
    expect(dialog).toHaveTextContent('August 29, 2026')
    expect(dialog).toHaveTextContent('Export your activity data')
    expect(dialog).toHaveTextContent('Download one person’s share or the full activity as a spreadsheet-ready CSV')
    expect(dialog).toHaveTextContent('Choose one person or everyone')
    expect(dialog).toHaveTextContent('Localized, detailed rows')
    expect(dialog).toHaveTextContent('August 23, 2026')
    expect(dialog).toHaveTextContent('Split a receipt by dish')
    expect(dialog).toHaveTextContent('Tally reads the items, tax, fees, and printed totals')
    expect(dialog).toHaveTextContent('August 20, 2026')
    expect(dialog).toHaveTextContent('Light or dark, your choice')
    expect(dialog).toHaveTextContent('Open Settings, find Appearance, then choose System, Light, or Dark.')
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
    expect(dialog).toHaveTextContent('2026年8月29日')
    expect(dialog).toHaveTextContent('把分账数据导出成 CSV')
    expect(dialog).toHaveTextContent('可以只导出一位成员，也可以导出整个活动')
    expect(dialog).toHaveTextContent('按成员或整个活动导出')
    expect(dialog).toHaveTextContent('本地化的完整数据')
    expect(dialog).toHaveTextContent('2026年8月23日')
    expect(dialog).toHaveTextContent('拍小票，按菜品分账')
    expect(dialog).toHaveTextContent('一道菜可以分给一人或多人')
    expect(dialog).toHaveTextContent('2026年8月20日')
    expect(dialog).toHaveTextContent('亮色或深色，由你选择')
    expect(dialog).toHaveTextContent('打开“设置”，在“外观”中选择“跟随系统”“浅色”或“深色”')
    expect(dialog).toHaveTextContent('2026年7月26日')
    expect(dialog).toHaveTextContent('分享更清楚，也更安心')
    expect(screen.getByText('更可靠的实时协作')).toBeVisible()
    expect(screen.getByRole('button', { name: '知道了' })).toBeVisible()
  })
})
