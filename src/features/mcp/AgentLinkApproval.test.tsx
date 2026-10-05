import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ACTIVITY_IDENTITY_KEY } from '../../data/activityIdentity'
import { LIVE_ACTIVITY_BOOKMARKS_KEY } from '../liveSharing/useLiveActivityBookmarks'
import { createLiveActivityMirror, LIVE_ACTIVITY_MIRRORS_KEY } from '../liveSharing/useLiveActivityMirrors'
import { TOKYO_CODE, TOKYO_TOKEN, tokyoActivity } from '../../test/mcpFixtures'
import { AgentLinkApprovalModal, AgentLinkGate } from './AgentLinkApproval'
import { decodeAgentLinkPayload } from './agentLinkProtocol'
import type { LinkableActivity } from './linkableActivities'

const state = '0123456789abcdef0123456789abcdef'
const members = tokyoActivity().friends.slice(0, 2)
const tokyo: LinkableActivity = { code: TOKYO_CODE, editToken: TOKYO_TOKEN, name: 'Tokyo trip', members: [tokyoActivity().sender, ...members], defaultMemberId: 'me' }
const ski: LinkableActivity = { code: 'B1B2C3D4E5', editToken: 'b'.repeat(64), name: 'Ski weekend', members, defaultMemberId: null }

async function chooseMember(activityName: string, memberName: string) {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: `Who you are in ${activityName}` }))
  await user.click(screen.getByRole('option', { name: memberName }))
}

afterEach(() => {
  window.history.replaceState(null, '', '/')
})

describe('AgentLinkApprovalModal', () => {
  it('asks which activities the agent may use and who the person is in each', async () => {
    const user = userEvent.setup()
    const onApprove = vi.fn()
    render(<AgentLinkApprovalModal activities={[ski, tokyo]} client="claude-code" hasUnavailable={false} onApprove={onApprove} onCancel={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'Let Claude Code use your activities?' })).toBeInTheDocument()
    expect(screen.getByText('Live · A1B2C3D4E5 · Mia, Leo, Sam')).toBeInTheDocument()
    expect(screen.getByText(/The agent never sees it/)).toBeInTheDocument()
    const allow = screen.getByRole('button', { name: 'Allow' })
    expect(allow).toBeDisabled()

    await user.click(screen.getByRole('checkbox', { name: /Ski weekend/ }))
    expect(allow).toBeDisabled()
    await chooseMember('Ski weekend', 'Sam')
    await user.click(screen.getByRole('checkbox', { name: /Tokyo trip/ }))
    await user.click(screen.getByRole('checkbox', { name: /Tokyo trip/ }))
    await user.click(allow)

    expect(onApprove).toHaveBeenCalledWith([{ code: 'B1B2C3D4E5', editToken: 'b'.repeat(64), memberId: 'friend-sam' }])
  })

  it('selects an activity when a member is picked and preselects a lone activity', async () => {
    const onApprove = vi.fn()
    const { unmount } = render(<AgentLinkApprovalModal activities={[ski, tokyo]} client="codex" hasUnavailable onApprove={onApprove} onCancel={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Let Codex use your activities?' })).toBeInTheDocument()
    expect(screen.getByText(/appear here only after you open them/)).toBeInTheDocument()
    await chooseMember('Ski weekend', 'Leo')
    expect(screen.getByRole('checkbox', { name: /Ski weekend/ })).toBeChecked()
    await chooseMember('Ski weekend', 'Choose yourself')
    expect(screen.getByRole('button', { name: 'Allow' })).toBeDisabled()
    unmount()

    render(<AgentLinkApprovalModal activities={[tokyo]} client="other" hasUnavailable={false} onApprove={onApprove} onCancel={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Let your AI agent use your activities?' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Tokyo trip/ })).toBeChecked()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Allow' }))
    expect(onApprove).toHaveBeenCalledWith([{ code: TOKYO_CODE, editToken: TOKYO_TOKEN, memberId: 'me' }])
  })

  it('refuses more activities than one hand-off can carry', async () => {
    const many = Array.from({ length: 21 }, (_, index) => ({ ...tokyo, code: `A1B2C3D4${String(index).padStart(2, '0')}`, name: `Trip ${index}` }))
    const onApprove = vi.fn()
    render(<AgentLinkApprovalModal activities={many} client="codex" hasUnavailable={false} onApprove={onApprove} onCancel={vi.fn()} />)
    const user = userEvent.setup()
    for (const checkbox of screen.getAllByRole('checkbox')) await user.click(checkbox)
    expect(screen.getByRole('button', { name: 'Allow' })).toBeDisabled()
    fireEvent.submit(screen.getByRole('button', { name: 'Allow' }).closest('form')!)
    expect(onApprove).not.toHaveBeenCalled()
  })

  it('keeps the person\'s choices when the list of activities refreshes', async () => {
    const props = { client: 'codex' as const, hasUnavailable: false, onApprove: vi.fn(), onCancel: vi.fn() }
    const { rerender } = render(<AgentLinkApprovalModal {...props} activities={[]} />)
    rerender(<AgentLinkApprovalModal {...props} activities={[ski]} />)
    expect(screen.getByRole('checkbox', { name: /Ski weekend/ })).toBeChecked()

    await chooseMember('Ski weekend', 'Sam')
    rerender(<AgentLinkApprovalModal {...props} activities={[ski, tokyo]} />)
    expect(screen.getByRole('checkbox', { name: /Ski weekend/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Tokyo trip/ })).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Who you are in Tokyo trip' })).toHaveTextContent('Mia')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Allow' }))
    expect(props.onApprove).toHaveBeenCalledWith([{ code: 'B1B2C3D4E5', editToken: 'b'.repeat(64), memberId: 'friend-sam' }])
  })

  it('explains what to do when the browser has no Live activities, and cancels', async () => {
    const onCancel = vi.fn()
    render(<AgentLinkApprovalModal activities={[]} client="codex" hasUnavailable={false} onApprove={vi.fn()} onCancel={onCancel} />)
    expect(screen.getByText(/no Live activities in this browser yet/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Allow' })).not.toBeInTheDocument()
    await userEvent.setup().click(within(screen.getByRole('dialog')).getAllByRole('button', { name: 'Close' }).at(-1)!)
    expect(onCancel).toHaveBeenCalled()
  })
})

describe('AgentLinkGate', () => {
  function storeTokyo() {
    localStorage.setItem(LIVE_ACTIVITY_BOOKMARKS_KEY, JSON.stringify({ 'live-a1b2c3d4e5': { code: TOKYO_CODE, editToken: TOKYO_TOKEN } }))
    localStorage.setItem(LIVE_ACTIVITY_MIRRORS_KEY, JSON.stringify({
      'live-a1b2c3d4e5': createLiveActivityMirror({ code: TOKYO_CODE, revision: 2, snapshot: tokyoActivity(), updatedAt: '2026-10-01T00:00:00.000Z' }),
    }))
    localStorage.setItem(ACTIVITY_IDENTITY_KEY, JSON.stringify({ [`live:${TOKYO_CODE}`]: 'friend-leo' }))
  }

  it('opens from the agent link, clears it from the address bar, and hands the approval to localhost', async () => {
    storeTokyo()
    window.history.replaceState(null, '', `/splitbill/#agent-link=51234.${state}.claude-code`)
    const navigate = vi.fn()
    render(<AgentLinkGate identityName="Mia" navigate={navigate} />)

    expect(window.location.hash).toBe('')
    expect(window.location.pathname).toBe('/splitbill/')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Allow' }))
    const callback = new URL(navigate.mock.calls[0][0])
    expect(callback.origin).toBe('http://127.0.0.1:51234')
    expect(callback.pathname).toBe('/done')
    expect(decodeAgentLinkPayload(callback.hash.slice(1))).toEqual({
      state,
      activities: [{ code: TOKYO_CODE, editToken: TOKYO_TOKEN, memberId: 'friend-leo' }],
    })
  })

  it('shows an activity another tab finished opening after the request appeared', async () => {
    window.history.replaceState(null, '', `/#agent-link=51234.${state}.claude-code`)
    render(<AgentLinkGate identityName="Mia" navigate={vi.fn()} />)
    expect(screen.getByText(/no Live activities in this browser yet/)).toBeInTheDocument()

    storeTokyo()
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: LIVE_ACTIVITY_MIRRORS_KEY })) })
    expect(screen.getByRole('checkbox', { name: /Tokyo trip/ })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Allow' })).toBeEnabled()
  })

  it('reads the activities again when the person comes back to the window', () => {
    window.history.replaceState(null, '', `/#agent-link=51234.${state}.codex`)
    const { unmount } = render(<AgentLinkGate identityName="Mia" navigate={vi.fn()} />)
    storeTokyo()
    act(() => { window.dispatchEvent(new FocusEvent('focus')) })
    expect(screen.getByRole('checkbox', { name: /Tokyo trip/ })).toBeInTheDocument()

    unmount()
    localStorage.clear()
    act(() => { window.dispatchEvent(new FocusEvent('focus')) })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('reports each request once and whether it was allowed or denied', async () => {
    storeTokyo()
    const onAnalytics = vi.fn()
    window.history.replaceState(null, '', `/#agent-link=51234.${state}.claude-code`)
    const { rerender } = render(<AgentLinkGate identityName="Mia" navigate={vi.fn()} onAnalytics={onAnalytics} />)
    rerender(<AgentLinkGate identityName="Mia" navigate={vi.fn()} onAnalytics={onAnalytics} />)
    expect(onAnalytics.mock.calls).toEqual([['agent_link_requested']])
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Allow' }))
    expect(onAnalytics.mock.calls).toEqual([['agent_link_requested'], ['agent_link_allowed']])

    act(() => {
      window.history.replaceState(null, '', `/#agent-link=51235.${state}.codex`)
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    await user.click(screen.getByRole('button', { name: 'Don’t allow' }))
    expect(onAnalytics.mock.calls).toEqual([['agent_link_requested'], ['agent_link_allowed'], ['agent_link_requested'], ['agent_link_denied']])
  })

  it('stays hidden without a request, opens on a later agent link and closes when denied', async () => {
    render(<AgentLinkGate />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    act(() => {
      window.history.replaceState(null, '', '/#live=nope')
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    act(() => {
      window.history.replaceState(null, '', `/#agent-link=51234.${state}.codex`)
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    expect(screen.getByRole('heading', { name: 'Let Codex use your activities?' })).toBeInTheDocument()
    await userEvent.setup().click(screen.getAllByRole('button', { name: 'Close' }).at(-1)!)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('navigates the real window by default', async () => {
    storeTokyo()
    const assign = vi.fn()
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, hash: `#agent-link=51234.${state}.codex`, href: `http://localhost:3000/#agent-link=51234.${state}.codex`, assign })
    render(<AgentLinkGate identityName="Leo" />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Allow' }))
    expect(assign).toHaveBeenCalledWith(expect.stringMatching(/^http:\/\/127\.0\.0\.1:51234\/done#/))
    vi.restoreAllMocks()
  })
})
