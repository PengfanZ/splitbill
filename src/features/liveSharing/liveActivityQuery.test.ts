import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import type { LiveActivityRecord } from './liveActivityApi'
import {
  LIVE_ACTIVITY_MAX_POLL_INTERVAL_MS,
  LIVE_ACTIVITY_POLL_INTERVAL_MS,
  liveActivityPollInterval,
  liveActivityQueryKey,
} from './liveActivityQuery'

describe('live activity query configuration', () => {
  it('isolates cached records by both parts of the editing capability', () => {
    expect(liveActivityQueryKey({ code: 'A1B2C3D4E5', editToken: 'a'.repeat(64) }))
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
})
