import { parseReceiptDraft, parseReceiptRequest, type ParseReceiptRequest } from './receiptContract'

export type ReceiptApiErrorKind =
  | 'configuration'
  | 'invalid-input'
  | 'rate-limit'
  | 'credits'
  | 'model-unavailable'
  | 'network'
  | 'invalid-response'
  | 'unavailable'

export class ReceiptApiError extends Error {
  constructor(public readonly kind: ReceiptApiErrorKind, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ReceiptApiError'
  }
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
type ReceiptConfiguration = {
  supabaseUrl: string
  publishableKey: string
  functionName?: string
  requestTimeoutMs?: number
}

export type ReceiptClient = ReturnType<typeof createReceiptClient>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorKind(status: number, payload: unknown): ReceiptApiErrorKind {
  const code = isRecord(payload) && typeof payload.code === 'string' ? payload.code : ''
  if ([400, 413, 422].includes(status)) return 'invalid-input'
  if (code === 'rate_limit_exceeded') return 'rate-limit'
  if (code === 'provider_payment_required' || code === 'ai_budget_exceeded') return 'credits'
  if (['model_unavailable', 'provider_unavailable', 'provider_rate_limit'].includes(code)) return 'model-unavailable'
  if (status === 429) return 'rate-limit'
  return 'unavailable'
}

async function readResponseJson(response: Response) {
  const text = await response.text()
  if (new TextEncoder().encode(text).byteLength > 512 * 1024) throw new RangeError('Response too large.')
  return JSON.parse(text) as unknown
}

export function createReceiptClient(configuration: ReceiptConfiguration, fetcher: Fetcher = fetch) {
  const supabaseUrl = configuration.supabaseUrl.trim().replace(/\/+$/, '')
  const publishableKey = configuration.publishableKey.trim()
  const functionName = configuration.functionName?.trim() || 'parse-receipt'
  const requestTimeoutMs = configuration.requestTimeoutMs ?? 30_000
  let parsedUrl: URL
  try {
    parsedUrl = new URL(supabaseUrl)
  } catch {
    throw new ReceiptApiError('configuration', 'A valid Supabase URL is required.')
  }
  const localUrl = parsedUrl.protocol === 'http:'
    && ['localhost', '127.0.0.1', '[::1]'].includes(parsedUrl.hostname)
  if (!publishableKey
    || !/^[a-z0-9](?:[a-z0-9-]{0,62})$/.test(functionName)
    || (parsedUrl.protocol !== 'https:' && !localUrl)
    || !Number.isInteger(requestTimeoutMs)
    || requestTimeoutMs < 1) {
    throw new ReceiptApiError('configuration', 'Supabase URL and publishable key are required.')
  }

  return {
    async parse(request: ParseReceiptRequest) {
      let validRequest: ParseReceiptRequest
      try {
        validRequest = parseReceiptRequest(request)
      } catch (cause) {
        throw new ReceiptApiError('invalid-input', 'Choose a valid receipt photo.', { cause })
      }

      let response: Response
      try {
        response = await fetcher(`${supabaseUrl}/functions/v1/${functionName}`, {
          method: 'POST',
          headers: {
            apikey: publishableKey,
            'content-type': 'application/json',
            'x-tally-input-mode': 'receipt',
          },
          cache: 'no-store',
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          signal: AbortSignal.timeout(requestTimeoutMs),
          body: JSON.stringify(validRequest),
        })
      } catch (cause) {
        throw new ReceiptApiError('network', 'Could not reach the receipt AI service.', { cause })
      }

      let payload: unknown
      try {
        payload = await readResponseJson(response)
      } catch (cause) {
        throw new ReceiptApiError('invalid-response', 'The receipt AI service returned unreadable data.', { cause })
      }
      if (!response.ok) {
        const message = isRecord(payload) && typeof payload.message === 'string'
          ? payload.message
          : 'Receipt splitting is temporarily unavailable.'
        throw new ReceiptApiError(errorKind(response.status, payload), message)
      }
      if (!isRecord(payload) || !('result' in payload)) {
        throw new ReceiptApiError('invalid-response', 'The receipt AI service returned an unexpected result.')
      }
      try {
        return parseReceiptDraft(payload.result)
      } catch (cause) {
        throw new ReceiptApiError('invalid-response', 'The receipt AI service returned an invalid draft.', { cause })
      }
    },
  }
}

type ReceiptEnvironment = {
  VITE_RECEIPT_SPLIT_ENABLED?: string
  VITE_RECEIPT_FUNCTION_NAME?: string
  VITE_SUPABASE_URL?: string
  VITE_SUPABASE_PUBLISHABLE_KEY?: string
}

export function createConfiguredReceiptClient(
  environment: ReceiptEnvironment = import.meta.env as ReceiptEnvironment,
): ReceiptClient | null {
  if (environment.VITE_RECEIPT_SPLIT_ENABLED !== 'true') return null
  const supabaseUrl = environment.VITE_SUPABASE_URL?.trim() ?? ''
  const publishableKey = environment.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? ''
  if (!supabaseUrl || !publishableKey) return null
  try {
    return createReceiptClient({
      supabaseUrl,
      publishableKey,
      functionName: environment.VITE_RECEIPT_FUNCTION_NAME,
    })
  } catch {
    return null
  }
}
