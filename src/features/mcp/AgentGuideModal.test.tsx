import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ExperimentalTag } from '../../components/ExperimentalTag'
import { LocalizationProvider } from '../../i18n/LocalizationContext'
import { AgentGuideModal, type AgentGuideTarget } from './AgentGuideModal'

const general: AgentGuideTarget = { kind: 'general' }
const tokyo: AgentGuideTarget = { kind: 'activity', name: 'Tokyo trip', code: 'A1B2C3D4E5' }

describe('AgentGuideModal', () => {
  it('guides a general visitor and marks the feature experimental', () => {
    render(<AgentGuideModal target={general} onClose={vi.fn()} onSendFeedback={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Let your coding agent keep the tab.' })).toBeInTheDocument()
    expect(screen.getByText('AI agents · Experimental')).toBeInTheDocument()
    expect(screen.getByText('claude mcp add tally -- npx -y tally-splitbill-mcp')).toBeInTheDocument()
    expect(screen.getByText(/Create a Ski weekend activity/)).toBeInTheDocument()
    expect(screen.getByText('Or use an activity you already have')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Full guide on npm' })).toHaveAttribute('href', 'https://www.npmjs.com/package/tally-splitbill-mcp')
    expect(screen.getByRole('link', { name: 'Full guide on npm' })).toHaveAttribute('target', '_blank')
  })

  it('switches to Codex and remembers it', async () => {
    const { unmount } = render(<AgentGuideModal target={general} onClose={vi.fn()} onSendFeedback={vi.fn()} />)
    expect(screen.getByRole('tab', { name: 'Claude Code' })).toHaveAttribute('aria-selected', 'true')
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Codex' }))
    expect(screen.getByText('codex mcp add tally -- npx -y tally-splitbill-mcp')).toBeInTheDocument()
    unmount()
    render(<AgentGuideModal target={general} onClose={vi.fn()} onSendFeedback={vi.fn()} />)
    expect(screen.getByRole('tab', { name: 'Codex' })).toHaveAttribute('aria-selected', 'true')
  })

  it('shows activity prompts with the activity name and copies them', async () => {
    const copy = vi.fn(async () => 'copied' as const)
    render(<AgentGuideModal target={tokyo} onClose={vi.fn()} onSendFeedback={vi.fn()} copy={copy} />)
    expect(screen.getByRole('heading', { name: 'Use Tokyo trip with your agent' })).toBeInTheDocument()
    expect(screen.getByText('AI agents · Experimental · Live · A1B2C3D4E5')).toBeInTheDocument()
    expect(screen.getByText('Ask for Tokyo trip, then click Allow')).toBeInTheDocument()
    expect(screen.getByText('Turning it off')).toBeInTheDocument()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /Who still owes me in Tokyo trip\?/ }))
    expect(copy).toHaveBeenCalledWith('Who still owes me in Tokyo trip?')
    expect(screen.getByRole('button', { name: /Who still owes me in Tokyo trip\?/ })).toHaveTextContent('Copied')

    await user.click(screen.getByRole('button', { name: 'Copy' }))
    expect(copy).toHaveBeenLastCalledWith('claude mcp add tally -- npx -y tally-splitbill-mcp')
    expect(screen.getByRole('button', { name: /Who still owes me in Tokyo trip\?/ })).not.toHaveTextContent('Copied')
  })

  it('says when copying fails and keeps the command on screen', async () => {
    render(<AgentGuideModal target={general} onClose={vi.fn()} onSendFeedback={vi.fn()} copy={async () => 'failed'} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Copy' }))
    expect(screen.getByRole('button', { name: 'Copy failed' })).toBeInTheDocument()
    expect(screen.getByText('claude mcp add tally -- npx -y tally-splitbill-mcp')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Codex' }))
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument()
  })

  it('says when copying a prompt fails', async () => {
    render(<AgentGuideModal target={tokyo} onClose={vi.fn()} onSendFeedback={vi.fn()} copy={async () => 'failed'} />)
    await userEvent.setup().click(screen.getByRole('button', { name: /Settle up Tokyo trip/ }))
    expect(screen.getByRole('button', { name: /Settle up Tokyo trip/ })).toHaveTextContent('Copy failed')
  })

  it('copies with the browser clipboard by default', async () => {
    // user-event installs its own clipboard stub, so replace it after setup.
    const user = userEvent.setup()
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<AgentGuideModal target={general} onClose={vi.fn()} onSendFeedback={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Copy' }))
    expect(writeText).toHaveBeenCalledWith('claude mcp add tally -- npx -y tally-splitbill-mcp')
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument()
  })

  it('asks for feedback and closes', async () => {
    const onClose = vi.fn()
    const onSendFeedback = vi.fn()
    render(<AgentGuideModal target={tokyo} onClose={onClose} onSendFeedback={onSendFeedback} />)
    const user = userEvent.setup()
    expect(screen.getByText(/This is an experimental feature and may change\./)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Tell us how it goes' }))
    expect(onSendFeedback).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('reports successful copies by agent and kind, and nothing when copying fails', async () => {
    const onCopied = vi.fn()
    const user = userEvent.setup()
    const { unmount } = render(<AgentGuideModal target={tokyo} onClose={vi.fn()} onSendFeedback={vi.fn()} copy={async () => 'copied'} onCopied={onCopied} />)
    await user.click(screen.getByRole('button', { name: 'Copy' }))
    await user.click(screen.getByRole('tab', { name: 'Codex' }))
    await user.click(screen.getByRole('button', { name: 'Copy' }))
    await user.click(screen.getByRole('button', { name: /Who still owes me in Tokyo trip\?/ }))
    expect(onCopied.mock.calls).toEqual([['agent_install_copied_claude_code'], ['agent_install_copied_codex'], ['agent_prompt_copied']])
    unmount()

    onCopied.mockClear()
    render(<AgentGuideModal target={tokyo} onClose={vi.fn()} onSendFeedback={vi.fn()} copy={async () => 'failed'} onCopied={onCopied} />)
    await user.click(screen.getByRole('button', { name: 'Copy' }))
    await user.click(screen.getByRole('button', { name: /Settle up Tokyo trip/ }))
    expect(onCopied).not.toHaveBeenCalled()
  })

  it('speaks Chinese', () => {
    render(<LocalizationProvider initialLocale="zh-CN"><AgentGuideModal target={tokyo} onClose={vi.fn()} onSendFeedback={vi.fn()} /></LocalizationProvider>)
    expect(screen.getByRole('heading', { name: '用 AI 助手管理「Tokyo trip」' })).toBeInTheDocument()
    expect(screen.getByText('AI 助手 · 实验功能 · 实时 · A1B2C3D4E5')).toBeInTheDocument()
  })
})

describe('ExperimentalTag', () => {
  it('labels a feature as experimental', () => {
    render(<ExperimentalTag />)
    expect(screen.getByText('Experimental')).toHaveClass('experimental-tag')
  })
})
