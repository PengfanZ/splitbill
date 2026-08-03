import type { AnalyticsClient, AnalyticsEvent, AnalyticsSurface } from '../../analytics'
import type { AppLocale } from '../../i18n/localization'
import type { AiExpenseClient } from './aiExpenseApi'

type AiExpenseInputMode = 'text' | 'voice'
type AiExpenseOutcome = 'requested' | 'ready' | 'clarification' | 'failed'

const AI_EXPENSE_EVENTS: Record<AiExpenseInputMode, Record<AiExpenseOutcome, AnalyticsEvent>> = {
  text: {
    requested: 'ai_text_requested',
    ready: 'ai_text_ready',
    clarification: 'ai_text_clarification',
    failed: 'ai_text_failed',
  },
  voice: {
    requested: 'ai_voice_requested',
    ready: 'ai_voice_ready',
    clarification: 'ai_voice_clarification',
    failed: 'ai_voice_failed',
  },
}

function trackSafely(
  analyticsClient: AnalyticsClient,
  event: AnalyticsEvent,
  surface: AnalyticsSurface,
  locale: AppLocale,
) {
  try {
    analyticsClient.track(event, surface, locale)
  } catch {
    // Observability must never change the AI entry outcome.
  }
}

export function withAiExpenseAnalytics(
  client: Pick<AiExpenseClient, 'parseBatch'> | null,
  analyticsClient: AnalyticsClient | null,
  surface: AnalyticsSurface,
  locale: AppLocale,
): Pick<AiExpenseClient, 'parseBatch'> | null {
  if (!client || !analyticsClient) return client

  return {
    async parseBatch(request) {
      const events = AI_EXPENSE_EVENTS[request.inputMode]
      trackSafely(analyticsClient, events.requested, surface, locale)

      try {
        const result = await client.parseBatch(request)
        trackSafely(
          analyticsClient,
          result.status === 'ready_batch' ? events.ready : events.clarification,
          surface,
          locale,
        )
        return result
      } catch (error) {
        trackSafely(analyticsClient, events.failed, surface, locale)
        throw error
      }
    },
  }
}
