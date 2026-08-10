import { z } from 'zod'
import type { AnalyticsSurface } from '../../analytics'
import type { AppLocale } from '../../i18n/localization'

export const FEEDBACK_CATEGORIES = ['general', 'idea', 'problem'] as const
export type FeedbackCategory = typeof FEEDBACK_CATEGORIES[number]
export const FEEDBACK_RATINGS = [1, 2, 3, 4, 5] as const
export type FeedbackRating = typeof FEEDBACK_RATINGS[number]

const feedbackSubmissionSchema = z.object({
  category: z.enum(FEEDBACK_CATEGORIES),
  message: z.string().trim().max(1000),
  locale: z.enum(['en', 'zh-CN']),
  rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).nullable(),
  surface: z.enum(['local', 'live']),
  release: z.string().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
}).strict().refine(
  submission => submission.rating !== null || submission.message.length >= 3,
  { message: 'A rating or feedback message is required.' },
).refine(
  submission => submission.message.length === 0 || submission.message.length >= 3,
  { message: 'Feedback messages must contain at least 3 characters.' },
)

export type FeedbackSubmission = {
  category: FeedbackCategory
  message: string
  locale: AppLocale
  rating: FeedbackRating | null
  surface: AnalyticsSurface
  release: string
}

export type FeedbackApiErrorKind =
  | 'configuration'
  | 'invalid-input'
  | 'rate-limit'
  | 'network'
  | 'unavailable'
  | 'invalid-response'

export class FeedbackApiError extends Error {
  constructor(public readonly kind: FeedbackApiErrorKind, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'FeedbackApiError'
  }
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
type FeedbackConfiguration = {
  supabaseUrl: string
  publishableKey: string
  requestTimeoutMs?: number
}

type FeedbackEnvironment = {
  VITE_SUPABASE_URL?: string
  VITE_SUPABASE_PUBLISHABLE_KEY?: string
}

export type FeedbackClient = ReturnType<typeof createFeedbackClient>

function isAllowedSupabaseUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
      || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  } catch {
    return false
  }
}

export function parseFeedbackSubmission(value: unknown): FeedbackSubmission {
  return feedbackSubmissionSchema.parse(value)
}

export function createFeedbackClient(
  configuration: FeedbackConfiguration,
  fetcher: Fetcher = fetch,
) {
  const supabaseUrl = configuration.supabaseUrl.trim().replace(/\/+$/, '')
  const publishableKey = configuration.publishableKey.trim()
  const requestTimeoutMs = configuration.requestTimeoutMs ?? 10_000

  if (!publishableKey
    || !isAllowedSupabaseUrl(supabaseUrl)
    || !Number.isInteger(requestTimeoutMs)
    || requestTimeoutMs < 1) {
    throw new FeedbackApiError('configuration', 'A valid Supabase URL, publishable key, and timeout are required.')
  }

  return {
    async submit(submission: FeedbackSubmission) {
      let validSubmission: FeedbackSubmission
      try {
        validSubmission = parseFeedbackSubmission(submission)
      } catch (cause) {
        throw new FeedbackApiError('invalid-input', 'A valid feedback message is required.', { cause })
      }

      let response: Response
      try {
        response = await fetcher(`${supabaseUrl}/rest/v1/rpc/submit_feedback`, {
          method: 'POST',
          headers: {
            apikey: publishableKey,
            authorization: `Bearer ${publishableKey}`,
            'content-type': 'application/json',
          },
          cache: 'no-store',
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          signal: AbortSignal.timeout(requestTimeoutMs),
          body: JSON.stringify({
            p_category: validSubmission.category,
            p_message: validSubmission.message,
            p_locale: validSubmission.locale,
            p_rating: validSubmission.rating,
            p_surface: validSubmission.surface,
            p_release: validSubmission.release,
          }),
        })
      } catch (cause) {
        throw new FeedbackApiError('network', 'Could not reach the feedback service.', { cause })
      }

      let result: unknown
      try {
        result = await response.json()
      } catch (cause) {
        throw new FeedbackApiError('invalid-response', 'The feedback service returned unreadable data.', { cause })
      }

      if (result === 'rate_limit' || response.status === 429) {
        throw new FeedbackApiError('rate-limit', 'Too many feedback submissions.')
      }
      if (result === 'invalid_request' || response.status === 400) {
        throw new FeedbackApiError('invalid-input', 'The feedback message was rejected.')
      }
      if (!response.ok) {
        throw new FeedbackApiError('unavailable', 'The feedback service is temporarily unavailable.')
      }
      if (result !== 'submitted') {
        throw new FeedbackApiError('invalid-response', 'The feedback service returned an unexpected result.')
      }
    },
  }
}

export function createConfiguredFeedbackClient(
  environment: FeedbackEnvironment = import.meta.env as FeedbackEnvironment,
): FeedbackClient | null {
  const supabaseUrl = environment.VITE_SUPABASE_URL?.trim() ?? ''
  const publishableKey = environment.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? ''
  if (!supabaseUrl || !publishableKey) return null
  try {
    return createFeedbackClient({ supabaseUrl, publishableKey })
  } catch {
    return null
  }
}
