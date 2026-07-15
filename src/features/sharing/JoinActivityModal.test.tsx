import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildLiveActivityUrl } from '../liveSharing/liveActivityLink'
import { BrowserToPwaHandoff, JoinActivityModal } from './JoinActivityModal'

const liveUrl = buildLiveActivityUrl({ code: 'A1B2C3D4E5', editToken: 'a'.repeat(64) }, 'https://pengfanz.github.io/splitbill/')

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
})

describe('JoinActivityModal', () => {
  it('validates a manually entered link and hands its private fragment to the app', async () => {
    const user = userEvent.setup()
    const onJoin = vi.fn()
    render(<JoinActivityModal onClose={vi.fn()} onJoin={onJoin} />)

    await user.click(screen.getByRole('button', { name: 'Open activity' }))
    expect(screen.getByRole('alert')).toHaveTextContent('valid Tally')
    await user.type(screen.getByLabelText('Shared activity link'), liveUrl)
    await user.click(screen.getByRole('button', { name: 'Open activity' }))
    expect(onJoin).toHaveBeenCalledWith(new URL(liveUrl).hash)
  })

  it('pastes a link from the clipboard when Safari allows it', async () => {
    const user = userEvent.setup()
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: vi.fn().mockResolvedValue(liveUrl) } })
    render(<JoinActivityModal onClose={vi.fn()} onJoin={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Paste link' }))
    expect(screen.getByLabelText('Shared activity link')).toHaveValue(liveUrl)
  })

  it('explains manual paste when clipboard access is unavailable or rejected', async () => {
    const user = userEvent.setup()
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
    const { rerender } = render(<JoinActivityModal onClose={vi.fn()} onJoin={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Paste link' }))
    expect(screen.getByRole('alert')).toHaveTextContent('manually')

    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: vi.fn().mockRejectedValue(new Error('blocked')) } })
    rerender(<JoinActivityModal onClose={vi.fn()} onJoin={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Paste link' }))
    expect(screen.getByRole('alert')).toHaveTextContent('could not read')
  })
})

describe('BrowserToPwaHandoff', () => {
  it('copies the browser session link for the installed app', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<BrowserToPwaHandoff url={liveUrl} />)
    await user.click(screen.getByRole('button', { name: 'Copy for app' }))
    expect(writeText).toHaveBeenCalledWith(liveUrl)
    expect(screen.getByText(/Link copied/)).toBeVisible()
  })

  it('shows a manual fallback when copying is blocked', async () => {
    const user = userEvent.setup()
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
    render(<BrowserToPwaHandoff url={liveUrl} />)
    await user.click(screen.getByRole('button', { name: 'Copy for app' }))
    expect(screen.getByText(/Copy this page/)).toBeVisible()
  })
})
