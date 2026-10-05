import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { onlineManager } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { STORAGE_KEY } from './data/storage'
import { IDENTITY_KEY } from './data/identity'
import { CURRENT_USER } from './domain/members'
import type { PersistedState } from './domain/models'
import { CHANGELOG_ENTRIES, CHANGELOG_SEEN_STORAGE_KEY, LATEST_CHANGELOG_ID } from './features/changelog/changelog'
import { createSharedActivity } from './features/sharing/sharedActivity'

const GENERAL_TITLE = 'Let your coding agent keep the tab.'

const sam = { id: 'sam', name: 'Sam', initials: 'S', color: '#abc' }
const weekend = { id: 'trip', name: 'Weekend', emoji: '☀', memberIds: ['me', 'sam'] }
const credentials = { code: 'A1B2C3D4E5', editToken: 'a'.repeat(64) }
const record = { code: credentials.code, revision: 1, snapshot: createSharedActivity(weekend, [CURRENT_USER, sam], []), updatedAt: '2026-10-05T12:00:00Z' }

beforeEach(() => {
  localStorage.setItem(CHANGELOG_SEEN_STORAGE_KEY, LATEST_CHANGELOG_ID)
  window.history.replaceState(null, '', '/')
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  onlineManager.setOnline(true)
})

function liveClient() {
  window.history.replaceState(null, '', `/#live=${credentials.code}.${credentials.editToken}`)
  return { create: vi.fn(), load: vi.fn().mockResolvedValue(record), poll: vi.fn().mockResolvedValue(record), update: vi.fn() }
}

async function openShareMenu(user: UserEvent) {
  await user.click(await screen.findByRole('button', { name: 'Share' }))
  return screen.getByRole('dialog', { name: 'Share activity' })
}

function rememberMia() {
  localStorage.setItem(IDENTITY_KEY, JSON.stringify({ id: 'me', name: 'Mia', initials: 'M', color: '#ead1b9' }))
}

describe('the experimental agent guide', () => {
  it('opens from the sidebar and hands off to feedback', async () => {
    rememberMia()
    render(<App liveActivityClient={null} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /Use with AI agents/ }))
    expect(await screen.findByRole('heading', { name: GENERAL_TITLE })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Tell us how it goes' }))
    expect(screen.queryByRole('heading', { name: GENERAL_TITLE })).not.toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'What should Tally do better?' })).toBeInTheDocument()
  })

  it('opens from the #agents link and clears it from the address bar', async () => {
    rememberMia()
    window.history.replaceState(null, '', '/splitbill/#agents')
    render(<App liveActivityClient={null} />)
    expect(await screen.findByRole('heading', { name: GENERAL_TITLE })).toBeInTheDocument()
    expect(window.location.hash).toBe('')
    expect(window.location.pathname).toBe('/splitbill/')
  })

  it('opens when the #agents link is followed while Tally is already open', async () => {
    rememberMia()
    render(<App liveActivityClient={null} />)
    expect(screen.queryByRole('heading', { name: GENERAL_TITLE })).not.toBeInTheDocument()
    act(() => {
      window.history.replaceState(null, '', '/#agents')
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    expect(await screen.findByRole('heading', { name: GENERAL_TITLE })).toBeInTheDocument()
    expect(window.location.hash).toBe('')
  })

  it('asks a first-time visitor for a name before showing the guide', async () => {
    window.history.replaceState(null, '', '/#agents')
    render(<App liveActivityClient={null} />)
    expect(screen.queryByRole('heading', { name: GENERAL_TITLE })).not.toBeInTheDocument()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Display name'), 'Mia')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('heading', { name: GENERAL_TITLE })).toBeInTheDocument()
  })

  it('offers the activity guide from the Share menu of an editable Live activity only', async () => {
    rememberMia()
    const user = userEvent.setup()
    render(<App liveActivityClient={liveClient()} />)
    await user.click(within(await openShareMenu(user)).getByRole('button', { name: /^Use with Codex or Claude Code/ }))
    expect(await screen.findByRole('heading', { name: 'Use Weekend with your agent' })).toBeInTheDocument()
    expect(screen.getByText('AI agents · Experimental · Live · A1B2C3D4E5')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Done' }))

    fireEvent(window, new Event('offline'))
    expect(screen.getByText('Editing paused')).toBeVisible()
    // While editing is paused there is no Share menu, so the agent guide can't be reached.
    expect(screen.queryByRole('button', { name: 'Share' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Use with Codex or Claude Code/ })).not.toBeInTheDocument()
  })

  it('leaves the guide out of a local activity\'s Share menu', async () => {
    rememberMia()
    const state: PersistedState = { groups: [weekend], friends: [sam], expenses: [], selectedGroupId: 'trip' }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    const user = userEvent.setup()
    render(<App liveActivityClient={null} />)
    expect(within(await openShareMenu(user)).queryByRole('button', { name: /Use with Codex or Claude Code/ })).not.toBeInTheDocument()
  })

  it('announces the guide in What\'s new as experimental', () => {
    expect(CHANGELOG_ENTRIES[0]).toMatchObject({ id: '2026-10-ai-agents', releasedOn: '2026-10-05', items: [{ icon: 'agent' }] })
  })

  it('keeps What\'s new closed when arriving from the #agents link, so the dialogs don\'t stack', async () => {
    rememberMia()
    localStorage.setItem(CHANGELOG_SEEN_STORAGE_KEY, '2026-09-ui-polish')
    window.history.replaceState(null, '', '/#agents')
    render(<App liveActivityClient={null} />)
    expect(await screen.findByRole('heading', { name: GENERAL_TITLE })).toBeInTheDocument()
    // What's new loads lazily, so give it time to appear before checking it stayed closed.
    await expect(screen.findByRole('dialog', { name: 'What’s new in Tally' }, { timeout: 600 })).rejects.toThrow()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByLabelText('New updates')).toBeInTheDocument()
  })

  it('keeps a returning user on their Live activity when they arrive from the #agents link', async () => {
    rememberMia()
    const client = liveClient()
    const first = render(<App liveActivityClient={client} />)
    expect(await screen.findByText('Live and synced · A1B2C3D4E5')).toBeVisible()
    first.unmount()

    window.history.replaceState(null, '', '/#agents')
    render(<App liveActivityClient={client} />)
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Done' }))
    expect(await screen.findByText('Live and synced · A1B2C3D4E5')).toBeVisible()
  })

  it('stays on the open Live activity when the #agents link is followed', async () => {
    rememberMia()
    render(<App liveActivityClient={liveClient()} />)
    expect(await screen.findByText('Live and synced · A1B2C3D4E5')).toBeVisible()
    act(() => {
      window.history.replaceState(null, '', '/#agents')
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Done' }))
    expect(await screen.findByText('Live and synced · A1B2C3D4E5')).toBeVisible()
  })
})
