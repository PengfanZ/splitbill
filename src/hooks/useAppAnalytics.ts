import { useEffect, useRef } from 'react'
import type { AnalyticsClient, AnalyticsSurface } from '../analytics'

export function useAppAnalytics(
  client: AnalyticsClient | null,
  initialSurface: AnalyticsSurface,
  liveActivityCode: string | null,
) {
  const appOpenTracked = useRef(false)
  const trackedLiveActivityCode = useRef<string | null>(null)

  useEffect(() => {
    if (appOpenTracked.current) return
    appOpenTracked.current = true
    client?.track('app_opened', initialSurface)
  }, [client, initialSurface])

  useEffect(() => {
    if (!liveActivityCode) {
      trackedLiveActivityCode.current = null
      return
    }
    if (trackedLiveActivityCode.current === liveActivityCode) return
    trackedLiveActivityCode.current = liveActivityCode
    client?.track('live_activity_opened', 'live')
  }, [client, liveActivityCode])
}
