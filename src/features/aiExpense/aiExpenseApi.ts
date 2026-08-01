import {
  parseAiExpenseRequest,
  parseAiExpenseResult,
  type AiExpenseRequest,
  type AiExpenseResult,
} from './aiExpenseContract'

export type AiExpenseApiErrorKind =
  | 'configuration'
  | 'invalid-input'
  | 'rate-limit'
  | 'model-unavailable'
  | 'credits'
  | 'unavailable'
  | 'network'
  | 'invalid-response'

export class AiExpenseApiError extends Error {
  constructor(public readonly kind: AiExpenseApiErrorKind, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'AiExpenseApiError'
  }
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
type AiExpenseConfiguration = {
  supabaseUrl: string
  publishableKey: string
  requestTimeoutMs?: number
}

export type AiExpenseClient = ReturnType<typeof createAiExpenseClient>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorKind(status: number, payload: unknown): AiExpenseApiErrorKind {
  const code = isRecord(payload) && typeof payload.code === 'string' ? payload.code : ''
  if (status === 400 || status === 413 || status === 422 || code === 'invalid_model_response') return 'invalid-input'
  if (status === 429) return 'rate-limit'
  if (code === 'provider_payment_required') return 'credits'
  if (['model_unavailable', 'provider_error', 'provider_unavailable'].includes(code)) return 'model-unavailable'
  return 'unavailable'
}

export function createAiExpenseClient(
  configuration: AiExpenseConfiguration,
  fetcher: Fetcher = fetch,
) {
  const supabaseUrl = configuration.supabaseUrl.trim().replace(/\/+$/, '')
  const publishableKey = configuration.publishableKey.trim()
  const requestTimeoutMs = configuration.requestTimeoutMs ?? 23_000
  let parsedUrl: URL
  try {
    parsedUrl = new URL(supabaseUrl)
  } catch {
    throw new AiExpenseApiError('configuration', 'A valid Supabase URL is required.')
  }
  const localUrl = parsedUrl.protocol === 'http:'
    && ['localhost', '127.0.0.1', '[::1]'].includes(parsedUrl.hostname)
  if (!publishableKey
    || (parsedUrl.protocol !== 'https:' && !localUrl)
    || !Number.isInteger(requestTimeoutMs)
    || requestTimeoutMs < 1) {
    throw new AiExpenseApiError('configuration', 'Supabase URL and publishable key are required.')
  }

  return {
    async parse(request: AiExpenseRequest): Promise<AiExpenseResult> {
      let validRequest: AiExpenseRequest
      try {
        validRequest = parseAiExpenseRequest(request)
      } catch (cause) {
        throw new AiExpenseApiError('invalid-input', 'A valid expense description is required.', { cause })
      }

      let response: Response
      try {
        response = await fetcher(`${supabaseUrl}/functions/v1/parse-expense`, {
          method: 'POST',
          headers: {
            apikey: publishableKey,
            'content-type': 'application/json',
          },
          cache: 'no-store',
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          signal: AbortSignal.timeout(requestTimeoutMs),
          body: JSON.stringify(validRequest),
        })
      } catch (cause) {
        throw new AiExpenseApiError('network', 'Could not reach the AI expense service.', { cause })
      }

      let payload: unknown
      try {
        payload = await response.json()
      } catch (cause) {
        throw new AiExpenseApiError('invalid-response', 'The AI expense service returned unreadable data.', { cause })
      }
      if (!response.ok) {
        const message = isRecord(payload) && typeof payload.message === 'string'
          ? payload.message
          : 'AI expense entry is temporarily unavailable.'
        throw new AiExpenseApiError(errorKind(response.status, payload), message)
      }
      if (!isRecord(payload) || !('result' in payload)) {
        throw new AiExpenseApiError('invalid-response', 'The AI expense service returned an unexpected result.')
      }
      try {
        return parseAiExpenseResult(payload.result)
      } catch (cause) {
        throw new AiExpenseApiError('invalid-response', 'The AI expense service returned an invalid draft.', { cause })
      }
    },
  }
}

type AiExpenseEnvironment = {
  VITE_AI_EXPENSE_ENABLED?: string
  VITE_SUPABASE_URL?: string
  VITE_SUPABASE_PUBLISHABLE_KEY?: string
}

export function createConfiguredAiExpenseClient(
  environment: AiExpenseEnvironment = import.meta.env as AiExpenseEnvironment,
): AiExpenseClient | null {
  if (environment.VITE_AI_EXPENSE_ENABLED !== 'true') return null
  const supabaseUrl = environment.VITE_SUPABASE_URL?.trim() ?? ''
  const publishableKey = environment.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? ''
  if (!supabaseUrl || !publishableKey) return null
  try {
    return createAiExpenseClient({ supabaseUrl, publishableKey })
  } catch {
    return null
  }
}
