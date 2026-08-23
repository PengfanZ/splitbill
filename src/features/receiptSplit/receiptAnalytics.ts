import type { AnalyticsClient, AnalyticsEvent, AnalyticsSurface } from '../../analytics'
import type { AppLocale } from '../../i18n/localization'
import type { ReceiptClient } from './receiptApi'

function trackSafely(
  analyticsClient: AnalyticsClient,
  event: AnalyticsEvent,
  surface: AnalyticsSurface,
  locale: AppLocale,
) {
  try {
    analyticsClient.track(event, surface, locale)
  } catch {
    // Product analytics must never change receipt entry behavior.
  }
}

export function withReceiptAnalytics(
  client: Pick<ReceiptClient, 'parse'> | null,
  analyticsClient: AnalyticsClient | null,
  surface: AnalyticsSurface,
  locale: AppLocale,
): Pick<ReceiptClient, 'parse'> | null {
  if (!client || !analyticsClient) return client
  return {
    async parse(request) {
      trackSafely(analyticsClient, 'ai_receipt_requested', surface, locale)
      try {
        const result = await client.parse(request)
        trackSafely(analyticsClient, 'ai_receipt_ready', surface, locale)
        return result
      } catch (error) {
        trackSafely(analyticsClient, 'ai_receipt_failed', surface, locale)
        throw error
      }
    },
  }
}

export function trackReceiptConfirmed(
  analyticsClient: AnalyticsClient | null,
  surface: AnalyticsSurface,
  locale: AppLocale,
) {
  if (analyticsClient) trackSafely(analyticsClient, 'ai_receipt_confirmed', surface, locale)
}
