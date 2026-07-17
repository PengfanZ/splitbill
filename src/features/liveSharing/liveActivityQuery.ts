import type { Query } from '@tanstack/react-query'
import type { LiveActivityRecord } from './liveActivityApi'
import type { LiveActivityClient } from './liveActivityConfig'
import type { LiveActivityCredentials } from './liveActivityLink'

export const LIVE_ACTIVITY_POLL_INTERVAL_MS = 15_000
export const LIVE_ACTIVITY_MAX_POLL_INTERVAL_MS = 60_000

export function liveActivityQueryKey(credentials: LiveActivityCredentials) {
  return ['live-activity', credentials.code, credentials.editToken] as const
}

export function liveActivityPollInterval(query: Query<LiveActivityRecord>) {
  const failureCount = query.state.fetchFailureCount
  return Math.min(
    LIVE_ACTIVITY_POLL_INTERVAL_MS * (2 ** failureCount),
    LIVE_ACTIVITY_MAX_POLL_INTERVAL_MS,
  )
}

export async function fetchLiveActivityRecord(
  client: LiveActivityClient,
  credentials: LiveActivityCredentials,
  cachedRecord?: LiveActivityRecord,
) {
  if (!cachedRecord) return { record: await client.load(credentials), changed: false }

  const latestRevision = await client.poll(credentials)
  if (latestRevision.revision <= cachedRecord.revision) return { record: cachedRecord, changed: false }

  const loadedRecord = await client.load(credentials)
  const changed = loadedRecord.revision > cachedRecord.revision
  return { record: changed ? loadedRecord : cachedRecord, changed }
}
