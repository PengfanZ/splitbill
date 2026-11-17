import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { LocalizationProvider } from '../../i18n/LocalizationContext'
import { captureInstallPrompt } from '../../pwa/installGuide'
import { InstallPromptCard } from './InstallPromptCard'

function renderCard(guide: Parameters<typeof InstallPromptCard>[0]['guide']) {
  const onShown = vi.fn()
  const onClose = vi.fn()
  const view = render(<InstallPromptCard guide={guide} onShown={onShown} onClose={onClose} />)
  return { onShown, onClose, view }
}

describe('InstallPromptCard', () => {
  it('opens the browser install dialog and reports the choice', async () => {
    captureInstallPrompt()
    const prompt = vi.fn().mockResolvedValue(undefined)
    window.dispatchEvent(Object.assign(new Event('beforeinstallprompt'), { prompt, userChoice: Promise.resolve({ outcome: 'accepted' }) }))
    const { onShown, onClose, view } = renderCard('native')

    expect(screen.getByRole('region', { name: 'Install Tally' })).toHaveTextContent('Install Tally on this device')
    const laterOnShown = vi.fn()
    view.rerender(<InstallPromptCard guide="native" onShown={laterOnShown} onClose={onClose} />)
    expect(onShown).toHaveBeenCalledOnce()
    expect(laterOnShown).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Install' }))
    expect(prompt).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledWith('accepted')
  })

  it('can be put off without opening the dialog', async () => {
    const { onClose } = renderCard('native')
    await userEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(onClose).toHaveBeenCalledWith('dismissed')
  })

  it('walks iPhone and iPad users through More, Share, Add to Home Screen and Open as Web App', async () => {
    const { onClose } = renderCard('ios')
    const card = screen.getByRole('region', { name: 'Install Tally' })
    expect(card).toHaveTextContent('Add Tally to your Home Screen')
    expect(screen.getAllByRole('listitem').map(item => item.textContent?.trim())).toEqual([
      'Tap ··· (More)',
      'Tap Share',
      'Choose Add to Home Screen. Not listed? Scroll down and tap Edit Actions to add it.',
      'Leave Open as Web App on, then tap Add',
    ])
    expect(card).toHaveTextContent('activities already in Safari stay in Safari')
    await userEvent.click(screen.getByRole('button', { name: 'Got it' }))
    expect(onClose).toHaveBeenCalledWith('dismissed')
  })

  it('points Mac Safari users to Add to Dock', () => {
    renderCard('mac-safari')
    expect(screen.getByRole('region', { name: 'Install Tally' })).toHaveTextContent('Add Tally to your Dock')
    expect(screen.getByText('In the menu bar, choose File → Add to Dock.')).toBeInTheDocument()
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument()
  })

  it('asks in-app browser users to open a real browser', () => {
    renderCard('in-app')
    expect(screen.getByRole('region', { name: 'Install Tally' })).toHaveTextContent('Open Tally in your browser')
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument()
  })

  it('is translated into Chinese', () => {
    render(<LocalizationProvider initialLocale="zh-CN"><InstallPromptCard guide="ios" onShown={vi.fn()} onClose={vi.fn()} /></LocalizationProvider>)
    expect(screen.getByRole('region', { name: '安装 Tally' })).toHaveTextContent('选择“添加到主屏幕”')
  })
})
