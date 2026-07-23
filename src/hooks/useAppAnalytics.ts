import { useEffect, useRef } from 'react'
import type { AnalyticsClient, AnalyticsSurface } from '../analytics'
import type { AppLocale } from '../i18n/localization'

export function useAppAnalytics(
  client: AnalyticsClient | null,
  initialSurface: AnalyticsSurface,
  locale: AppLocale,
  liveActivityCode: string | null,
) {
  const appOpenTracked = useRef(false)
  const trackedLiveActivityCode = useRef<string | null>(null)

  useEffect(() => {
    if (appOpenTracked.current) return
    appOpenTracked.current = true
    client?.track('app_opened', initialSurface, locale)
  }, [client, initialSurface, locale])

  useEffect(() => {
    if (!liveActivityCode) {
      trackedLiveActivityCode.current = null
      return
    }
    if (trackedLiveActivityCode.current === liveActivityCode) return
    trackedLiveActivityCode.current = liveActivityCode
    client?.track('live_activity_opened', 'live', locale)
  }, [client, liveActivityCode, locale])
}
