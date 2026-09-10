import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { onlineManager } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { STORAGE_KEY } from './data/storage'
import { IDENTITY_KEY } from './data/identity'
import { ACTIVITY_IDENTITY_KEY } from './data/activityIdentity'
import { CURRENT_USER } from './domain/members'
import type { Expense, PersistedState } from './domain/models'
import { CHANGELOG_SEEN_STORAGE_KEY, LATEST_CHANGELOG_ID } from './features/changelog/changelog'
import { createSharedActivity, type SharedActivity } from './features/sharing/sharedActivity'
import { LiveActivityApiError } from './features/liveSharing/liveActivityApi'
import { LIVE_ACTIVITY_MIRRORS_KEY } from './features/liveSharing/useLiveActivityMirrors'

const sam = { id: 'sam', name: 'Sam', initials: 'S', color: '#abc' }
const maya = { id: 'maya', name: 'Maya', initials: 'M', color: '#def' }
const group = { id: 'trip', name: 'Weekend', emoji: '☀', memberIds: ['me', 'sam', 'maya'] }
const expense: Expense = { id: 'dinner', groupId: 'trip', title: 'Dinner', amount: 20, payerId: 'me', splitMethod: 'equal', shares: { me: 10, maya: 10 }, createdAt: '2026-09-09T12:00:00Z' }
const state: PersistedState = { groups: [group], friends: [sam, maya], expenses: [expense], selectedGroupId: 'trip' }
const credentials = { code: 'A1B2C3D4E5', editToken: 'a'.repeat(64) }
const snapshot = createSharedActivity(group, [CURRENT_USER, sam, maya], [expense])
const record = { code: credentials.code, revision: 1, snapshot, updatedAt: '2026-09-09T12:00:00Z' }

beforeEach(() => {
  window.history.replaceState(null, '', '/')
  localStorage.setItem(IDENTITY_KEY, JSON.stringify(CURRENT_USER))
  localStorage.setItem(CHANGELOG_SEEN_STORAGE_KEY, LATEST_CHANGELOG_ID)
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  window.dispatchEvent(new Event('online'))
  onlineManager.setOnline(true)
})

function liveClient() {
  window.history.replaceState(null, '', `/#live=${credentials.code}.${credentials.editToken}`)
  return {
    create: vi.fn(), load: vi.fn().mockResolvedValue(record), poll: vi.fn().mockResolvedValue(record),
    update: vi.fn().mockImplementation(async (_credentials: unknown, next: SharedActivity) => ({ ...record, snapshot: next, revision: 2 })),
  }
}

describe('friend removal in local and live activities', () => {
  it.each(['local', 'live'] as const)('tracks only confirmed successful %s removal, not cancellation, restore or reload', async surface => {
    const user = userEvent.setup()
    const track = vi.fn()
    const client = surface === 'live' ? liveClient() : null
    if (!client) localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    const view = render(<App liveActivityClient={client} analyticsClient={{ track }} />)
    const removals = () => track.mock.calls.filter(([event]) => event === 'friend_removed')
    await user.click(await screen.findByRole('button', { name: 'Remove Sam from activity' }))
    expect(removals()).toEqual([])
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(removals()).toEqual([])
    await user.click(screen.getByRole('button', { name: 'Remove Sam from activity' }))
    await user.click(screen.getByRole('button', { name: 'Remove friend' }))
    await waitFor(() => expect(removals()).toEqual([['friend_removed', surface, 'en']]))
    await user.click(screen.getByText('Removed friends (1)'))
    await user.click(screen.getByRole('button', { name: 'Restore Sam' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove Sam from activity' })).toBeVisible())
    expect(removals()).toHaveLength(1)
    view.unmount()
    render(<App liveActivityClient={client} analyticsClient={{ track }} />)
    await screen.findByRole('button', { name: 'Remove Sam from activity' })
    expect(removals()).toHaveLength(1)
  })

  it.each(['network', 'conflict'] as const)('does not track a failed %s removal and counts a successful retry once', async kind => {
    const user = userEvent.setup()
    const client = liveClient()
    const track = vi.fn()
    client.update.mockRejectedValueOnce(new LiveActivityApiError(kind, 'failed', kind === 'conflict' ? { latestRecord: record } : undefined))
    render(<App liveActivityClient={client} analyticsClient={{ track }} />)
    await user.click(await screen.findByRole('button', { name: 'Remove Sam from activity' }))
    await user.click(screen.getByRole('button', { name: 'Remove friend' }))
    await screen.findByRole('alert')
    expect(track.mock.calls.filter(([event]) => event === 'friend_removed')).toEqual([])
    if (kind === 'conflict') {
      await user.click(screen.getByRole('button', { name: 'Remove friend' }))
      await waitFor(() => expect(track.mock.calls.filter(([event]) => event === 'friend_removed')).toEqual([['friend_removed', 'live', 'en']]))
    }
  })
  it('restores a local friend without replacing their identity or old expenses', async () => {
    const user = userEvent.setup()
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, groups: [{ ...group, inactiveMemberIds: ['sam', 'maya'] }] }))
    render(<App liveActivityClient={null} />)
    await user.click(screen.getByText('Removed friends (2)'))
    await user.click(screen.getByRole('button', { name: 'Restore Sam' }))
    expect(screen.getByRole('button', { name: 'Remove Sam from activity' })).toBeVisible()
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({ ...state, groups: [{ ...group, inactiveMemberIds: ['maya'] }] })
  })

  it('restores a live friend through the same revision-checked session', async () => {
    const user = userEvent.setup()
    const client = liveClient()
    client.load.mockResolvedValue({ ...record, snapshot: { ...snapshot, group: { ...group, inactiveMemberIds: ['sam'] } } })
    render(<App liveActivityClient={client} />)
    await user.click(await screen.findByText('Removed friends (1)'))
    await user.click(screen.getByRole('button', { name: 'Restore Sam' }))
    await waitFor(() => expect(client.update).toHaveBeenCalledWith(credentials, expect.objectContaining({ group: { ...group, inactiveMemberIds: [] }, expenses: [expense] }), 1))
    await screen.findByRole('button', { name: 'Remove Sam from activity' })
  })

  it('keeps a rejected live draft open and lets the user review the current people', async () => {
    const user = userEvent.setup()
    const client = liveClient()
    const latest = { ...record, revision: 2, snapshot: { ...snapshot, group: { ...group, inactiveMemberIds: ['sam'] } } }
    client.update.mockRejectedValueOnce(new LiveActivityApiError('membership-changed', 'changed', { latestRecord: latest }))
    render(<App liveActivityClient={client} />)
    await user.click(await screen.findByRole('button', { name: 'Add expense' }))
    await user.type(screen.getByLabelText('Description'), 'Coffee')
    await user.type(screen.getByLabelText('Amount'), '12')
    await user.click(screen.getByRole('button', { name: 'Save expense' }))
    await screen.findByRole('button', { name: 'Use current participants' })
    expect(screen.getByRole('dialog')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Save expense' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Use current participants' }))
    await user.click(screen.getByRole('button', { name: 'Save expense' }))
    await waitFor(() => expect(client.update).toHaveBeenCalledTimes(2))
    expect(client.update.mock.calls[1][1].expenses[0].shares).toEqual({ me: 6, maya: 6 })
    expect(client.update.mock.calls[1][2]).toBe(2)
  })
  it('cancels safely then persists removal without changing earlier expenses or identity', async () => {
    const user = userEvent.setup()
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    localStorage.setItem(ACTIVITY_IDENTITY_KEY, JSON.stringify({ 'local:trip': 'sam' }))
    const view = render(<App liveActivityClient={null} />)
    expect(screen.queryByRole('button', { name: 'Remove You from activity' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Remove Sam from activity' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual(state)
    await user.click(screen.getByRole('button', { name: 'Remove Sam from activity' }))
    await user.click(screen.getByRole('button', { name: 'Remove friend' }))
    expect(screen.queryByRole('button', { name: 'Remove Sam from activity' })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Sam was removed')
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!) as PersistedState
    expect(saved.expenses).toEqual([expense])
    expect(saved.friends).toEqual([sam, maya])
    expect(saved.groups[0].inactiveMemberIds).toEqual(['sam'])
    view.unmount()
    render(<App liveActivityClient={null} />)
    expect(screen.queryByRole('button', { name: 'Remove Sam from activity' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add expense' }))
    await user.click(screen.getByRole('button', { name: 'Paid by' }))
    expect(screen.queryByRole('option', { name: 'Sam' })).not.toBeInTheDocument()
  })

  it('lists referenced bills and settlements, then preserves them on removal', async () => {
    const user = userEvent.setup()
    const settled = { ...state, expenses: [expense, { ...expense, id: 'payment', kind: 'settlement' as const, payerId: 'maya', amount: 10, splitMethod: 'exact' as const, shares: { me: 10 } }] }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settled))
    render(<App liveActivityClient={null} />)
    await user.click(screen.getByRole('button', { name: 'Remove Maya from activity' }))
    const dialog = screen.getByRole('dialog', { name: 'Remove Maya from future expenses?' })
    expect(within(dialog).getByText('Related records (2)')).toBeVisible()
    expect(within(dialog).getByRole('button', { name: 'Remove friend' })).toBeEnabled()
    await user.click(within(dialog).getByRole('button', { name: 'Remove friend' }))
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({ ...settled, groups: [{ ...group, inactiveMemberIds: ['maya'] }] })
  })

  it('saves live removal with revision protection and updates the local recovery mirror', async () => {
    const user = userEvent.setup()
    const client = liveClient()
    render(<App liveActivityClient={client} />)
    await user.click(await screen.findByRole('button', { name: 'Remove Sam from activity' }))
    await user.click(screen.getByRole('button', { name: 'Remove friend' }))
    await waitFor(() => expect(client.update).toHaveBeenCalledWith(credentials, expect.objectContaining({ group: { ...group, inactiveMemberIds: ['sam'] }, friends: [sam, maya], expenses: [expense] }), 1))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByText('Live · revision 2')).toBeVisible()
    expect(localStorage.getItem(LIVE_ACTIVITY_MIRRORS_KEY)).toContain('"inactiveMemberIds":["sam"]')
  })

  it('does not overwrite a concurrent expense and updates the dialog to explain the new reference', async () => {
    const user = userEvent.setup()
    const client = liveClient()
    const latest = { ...record, revision: 2, snapshot: { ...snapshot, expenses: [expense, { ...expense, id: 'taxi', title: 'Taxi', payerId: 'sam' }] } }
    client.update.mockRejectedValueOnce(new LiveActivityApiError('conflict', 'stale', { latestRecord: latest }))
    render(<App liveActivityClient={client} />)
    await user.click(await screen.findByRole('button', { name: 'Remove Sam from activity' }))
    await user.click(screen.getByRole('button', { name: 'Remove friend' }))
    expect(await screen.findByRole('dialog', { name: 'Remove Sam from future expenses?' })).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent('not removed')
    expect(client.update).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Live · revision 2')).toBeVisible()
    expect(within(screen.getByRole('dialog')).getByText('Taxi')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Remove friend' }))
    await waitFor(() => expect(client.update).toHaveBeenCalledTimes(2))
    expect(client.update.mock.calls[1][1].expenses).toEqual(latest.snapshot.expenses)
    expect(client.update.mock.calls[1][2]).toBe(2)
  })

  it('disables an open removal confirmation when the live activity goes offline', async () => {
    const user = userEvent.setup()
    const client = liveClient()
    render(<App liveActivityClient={client} />)
    await user.click(await screen.findByRole('button', { name: 'Remove Sam from activity' }))
    act(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
      fireEvent(window, new Event('offline'))
    })
    expect(screen.getByRole('button', { name: 'Remove friend' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('Connect and refresh')
    expect(client.update).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('button', { name: 'Remove Sam from activity' })).not.toBeInTheDocument()
  })

  it('keeps removal open on network failure without hiding the friend', async () => {
    const user = userEvent.setup()
    const client = liveClient()
    client.update.mockRejectedValueOnce(new LiveActivityApiError('network', 'offline'))
    render(<App liveActivityClient={client} />)
    await user.click(await screen.findByRole('button', { name: 'Remove Sam from activity' }))
    await user.click(screen.getByRole('button', { name: 'Remove friend' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Connect and refresh')
    expect(screen.getByRole('dialog', { name: 'Remove Sam from future expenses?' })).toBeVisible()
    expect(localStorage.getItem(LIVE_ACTIVITY_MIRRORS_KEY)).toContain('"id":"sam"')
  })
})
