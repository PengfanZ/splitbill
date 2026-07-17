import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { CURRENT_USER } from '../../domain/members'
import { createSharedActivity } from '../sharing/shareActivityUrl'
import type { LiveActivityRecord } from './liveActivityApi'
import type { LiveActivityClient } from './liveActivityConfig'
import {
  LIVE_ACTIVITY_MAX_POLL_INTERVAL_MS,
  LIVE_ACTIVITY_POLL_INTERVAL_MS,
  fetchLiveActivityRecord,
  liveActivityPollInterval,
  liveActivityQueryKey,
} from './liveActivityQuery'

const credentials = { code: 'A1B2C3D4E5', editToken: 'a'.repeat(64) }
const snapshot = createSharedActivity(
  { id: 'trip', name: 'Trip', emoji: '✦', memberIds: ['me'] },
  [CURRENT_USER],
  [],
)

function record(revision: number): LiveActivityRecord {
  return { code: credentials.code, revision, snapshot, updatedAt: `2026-07-14T01:0${revision}:00.000Z` }
}

function clientWith(load: LiveActivityClient['load'], poll: LiveActivityClient['poll']): LiveActivityClient {
  return { create: vi.fn(), load, poll, update: vi.fn() }
}

describe('live activity query configuration', () => {
  it('isolates cached records by both parts of the editing capability', () => {
    expect(liveActivityQueryKey(credentials))
      .toEqual(['live-activity', 'A1B2C3D4E5', 'a'.repeat(64)])
  })

  it('backs off failed polling up to a one-minute cap', () => {
    const client = new QueryClient()
    const query = client.getQueryCache().build<LiveActivityRecord>(client, {
      queryKey: ['live-activity'],
      queryFn: () => Promise.reject(new Error('offline')),
    })

    expect(liveActivityPollInterval(query)).toBe(LIVE_ACTIVITY_POLL_INTERVAL_MS)
    query.setState({ ...query.state, fetchFailureCount: 1 })
    expect(liveActivityPollInterval(query)).toBe(LIVE_ACTIVITY_POLL_INTERVAL_MS * 2)
    query.setState({ ...query.state, fetchFailureCount: 10 })
    expect(liveActivityPollInterval(query)).toBe(LIVE_ACTIVITY_MAX_POLL_INTERVAL_MS)
  })

  it('loads an uncached activity without making a revision-only request', async () => {
    const load = vi.fn().mockResolvedValue(record(1))
    const poll = vi.fn()

    await expect(fetchLiveActivityRecord(clientWith(load, poll), credentials)).resolves.toEqual({ record: record(1), changed: false })
    expect(load).toHaveBeenCalledWith(credentials)
    expect(poll).not.toHaveBeenCalled()
  })

  it('keeps cached data until a newer full record is available', async () => {
    const cached = record(1)
    const load = vi.fn()
      .mockResolvedValueOnce(record(2))
      .mockResolvedValueOnce(record(1))
    const poll = vi.fn()
      .mockResolvedValueOnce({ code: credentials.code, revision: 1, updatedAt: cached.updatedAt })
      .mockResolvedValue({ code: credentials.code, revision: 2, updatedAt: record(2).updatedAt })
    const client = clientWith(load, poll)

    await expect(fetchLiveActivityRecord(client, credentials, cached)).resolves.toEqual({ record: cached, changed: false })
    await expect(fetchLiveActivityRecord(client, credentials, cached)).resolves.toEqual({ record: record(2), changed: true })
    await expect(fetchLiveActivityRecord(client, credentials, cached)).resolves.toEqual({ record: cached, changed: false })
    expect(load).toHaveBeenCalledTimes(2)
  })
})
