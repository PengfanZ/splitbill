import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { IDENTITY_KEY } from './data/identity'
import { CHANGELOG_SEEN_STORAGE_KEY, LATEST_CHANGELOG_ID } from './features/changelog/changelog'
import { LIVE_ACTIVITY_BOOKMARKS_KEY } from './features/liveSharing/useLiveActivityBookmarks'
import { createLiveActivityMirror, LIVE_ACTIVITY_MIRRORS_KEY } from './features/liveSharing/useLiveActivityMirrors'
import { TOKYO_CODE, TOKYO_TOKEN, tokyoActivity } from './test/mcpFixtures'

const agentLinkHash = '#agent-link=51234.0123456789abcdef0123456789abcdef.claude-code'

beforeEach(() => {
  localStorage.setItem(CHANGELOG_SEEN_STORAGE_KEY, LATEST_CHANGELOG_ID)
  localStorage.setItem(LIVE_ACTIVITY_BOOKMARKS_KEY, JSON.stringify({ 'live-a1b2c3d4e5': { code: TOKYO_CODE, editToken: TOKYO_TOKEN } }))
  localStorage.setItem(LIVE_ACTIVITY_MIRRORS_KEY, JSON.stringify({
    'live-a1b2c3d4e5': createLiveActivityMirror({ code: TOKYO_CODE, revision: 2, snapshot: tokyoActivity(), updatedAt: '2026-10-01T00:00:00.000Z' }),
  }))
  window.history.replaceState(null, '', `/${agentLinkHash}`)
})

describe('connecting a coding agent', () => {
  it('asks to allow the agent when tally-splitbill-mcp opens Tally, preselecting the matching member', async () => {
    localStorage.setItem(IDENTITY_KEY, JSON.stringify({ id: 'me', name: 'Sam', initials: 'S', color: '#ead1b9' }))
    render(<App liveActivityClient={null} />)

    expect(await screen.findByRole('heading', { name: 'Let Claude Code use your activities?' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Tokyo trip/ })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Who you are in Tokyo trip' })).toHaveTextContent('Sam')
    expect(window.location.hash).toBe('')
  })

  it('waits for a first-time visitor to choose a name before asking', async () => {
    render(<App liveActivityClient={null} />)
    expect(screen.queryByRole('heading', { name: 'Let Claude Code use your activities?' })).not.toBeInTheDocument()

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Display name'), 'Mia')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('heading', { name: 'Let Claude Code use your activities?' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Who you are in Tokyo trip' })).toHaveTextContent('Mia')
  })

  it('counts the approval request and a denial without any activity data', async () => {
    localStorage.setItem(IDENTITY_KEY, JSON.stringify({ id: 'me', name: 'Sam', initials: 'S', color: '#ead1b9' }))
    const track = vi.fn()
    render(<App liveActivityClient={null} analyticsClient={{ track }} />)
    await screen.findByRole('heading', { name: 'Let Claude Code use your activities?' })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Don’t allow' }))
    expect(track.mock.calls.filter(([event]) => String(event).startsWith('agent_'))).toEqual([
      ['agent_link_requested', 'local', 'en'],
      ['agent_link_denied', 'local', 'en'],
    ])
  })
})
