import { MAX_RECEIPT_UPLOAD_BYTES, parseReceiptRequest } from './receiptContract.ts'
import {
  buildReceiptOpenRouterRequest,
  DEFAULT_OPENROUTER_RECEIPT_FALLBACK_MODEL,
  DEFAULT_OPENROUTER_RECEIPT_MODEL,
  parseOpenRouterReceiptOutput,
  ReceiptModelOutputError,
  type ReceiptModelOutputIssue,
  type ReceiptModelOutputFailureReason,
} from './receiptPrompt.ts'

export const RECEIPT_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': [
    'authorization',
    'x-client-info',
    'apikey',
    'content-type',
    'x-retry-count',
    'x-tally-input-mode',
  ].join(', '),
}

export type ReceiptQuotaResult = 'allowed' | 'client-limit' | 'global-limit'
type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export type ParseReceiptHandlerDependencies = {
  consumeQuota: (identifier: string) => Promise<ReceiptQuotaResult>
  fetcher?: Fetcher
  getEnvironment: (name: string) => string | undefined
  parseProviderOutput?: typeof parseOpenRouterReceiptOutput
  reportProviderFailure?: (failure: {
    models: string[]
    status: number
    errorType: string | null
  }) => void
  reportModelOutputFailure?: (failure: {
    models: string[]
    model: string
    attempt: number
    reason: ReceiptModelOutputFailureReason
    issues: ReceiptModelOutputIssue[]
  }) => void
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const MAX_RECEIPT_REQUEST_BYTES = Math.ceil(MAX_RECEIPT_UPLOAD_BYTES * 4 / 3) + 2_048
const MAX_PROVIDER_RESPONSE_BYTES = 256 * 1024
const PROVIDER_TIMEOUT_MS = 25_000
const DATA_URL_PATTERN = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/

function jsonError(status: number, code: string, message: string, headers: HeadersInit = {}) {
  return Response.json({ code, message }, {
    status,
    headers: { ...headers, 'cache-control': 'no-store' },
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requestIdentifier(request: Request) {
  const candidate = request.headers.get('cf-connecting-ip')?.trim() ?? ''
  return candidate.length <= 64 && /^[0-9a-f:.]+$/i.test(candidate)
    ? candidate
    : 'unknown-client'
}

async function readTextWithLimit(stream: ReadableStream<Uint8Array> | null, maxBytes: number) {
  if (!stream) throw new Error('Missing response body.')
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new RangeError('Payload is too large.')
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

function validateImageDataUrl(dataUrl: string) {
  const match = DATA_URL_PATTERN.exec(dataUrl)
  if (!match) throw new Error('Unsupported receipt image.')
  const encoded = match[2]
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0
  const estimatedBytes = Math.floor(encoded.length * 3 / 4) - padding
  if (estimatedBytes <= 0 || estimatedBytes > MAX_RECEIPT_UPLOAD_BYTES) {
    throw new RangeError('Receipt image is too large.')
  }
}

function getOpenRouterFailure(value: unknown) {
  if (!isRecord(value)) return null
  const firstChoice = Array.isArray(value.choices) ? value.choices[0] : null
  const error = isRecord(value.error)
    ? value.error
    : isRecord(firstChoice) && isRecord(firstChoice.error) ? firstChoice.error : null
  if (!error) return null
  const metadata = isRecord(error.metadata) ? error.metadata : null
  return {
    status: typeof error.code === 'number' ? error.code : null,
    errorType: metadata && typeof metadata.error_type === 'string' ? metadata.error_type : null,
  }
}

function providerFailureResponse(status: number, errorType: string | null) {
  if (status === 402 || errorType === 'payment_required') {
    return jsonError(503, 'provider_payment_required', 'Receipt AI credits are currently unavailable.')
  }
  if (status === 429 || errorType === 'rate_limit_exceeded') {
    return jsonError(429, 'provider_rate_limit', 'The receipt AI models are busy. Try again shortly.')
  }
  if ([408, 502, 503, 504].includes(status)
    || ['provider_overloaded', 'provider_unavailable', 'timeout'].includes(errorType ?? '')) {
    return jsonError(503, 'model_unavailable', 'The receipt AI models could not respond.')
  }
  return jsonError(502, 'provider_error', 'The AI provider could not read this receipt.')
}

export async function handleParseReceiptRequest(
  request: Request,
  dependencies: ParseReceiptHandlerDependencies,
) {
  if (request.method !== 'POST') {
    return jsonError(405, 'method_not_allowed', 'Use POST to read a receipt.')
  }
  if (request.headers.get('x-tally-input-mode') !== 'receipt') {
    return jsonError(400, 'invalid_request', 'Choose receipt expense entry.')
  }
  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (Number.isFinite(contentLength) && contentLength > MAX_RECEIPT_REQUEST_BYTES) {
    return jsonError(413, 'request_too_large', 'The receipt photo is too large.')
  }
  let parsedRequest
  try {
    const requestText = await readTextWithLimit(request.body, MAX_RECEIPT_REQUEST_BYTES)
    parsedRequest = parseReceiptRequest(JSON.parse(requestText))
    validateImageDataUrl(parsedRequest.image.dataUrl)
  } catch (error) {
    if (error instanceof RangeError) {
      return jsonError(413, 'request_too_large', 'The receipt photo is too large.')
    }
    return jsonError(400, 'invalid_request', 'Choose a clear JPG, PNG, or WebP receipt photo.')
  }

  if (dependencies.getEnvironment('AI_RECEIPT_ENABLED') !== 'true') {
    return jsonError(503, 'ai_disabled', 'Receipt splitting is currently disabled.')
  }
  const apiKey = dependencies.getEnvironment('OPENROUTER_API_KEY')?.trim() ?? ''
  if (!apiKey) return jsonError(503, 'ai_not_configured', 'Receipt splitting is not configured.')

  try {
    const quota = await dependencies.consumeQuota(requestIdentifier(request))
    if (quota === 'client-limit') {
      return jsonError(
        429,
        'rate_limit_exceeded',
        'Too many receipt scans. Try again in about 10 minutes.',
        { 'retry-after': '600' },
      )
    }
    if (quota === 'global-limit') {
      return jsonError(503, 'ai_budget_exceeded', 'The receipt scanning budget is temporarily unavailable.')
    }
  } catch {
    return jsonError(503, 'rate_limit_unavailable', 'Receipt splitting is temporarily unavailable.')
  }

  const model = dependencies.getEnvironment('OPENROUTER_RECEIPT_MODEL')?.trim()
    || DEFAULT_OPENROUTER_RECEIPT_MODEL
  const fallbackModel = dependencies.getEnvironment('OPENROUTER_RECEIPT_FALLBACK_MODEL')?.trim()
    || DEFAULT_OPENROUTER_RECEIPT_FALLBACK_MODEL
  const models = model === fallbackModel ? [model] : [model, fallbackModel]
  const attemptModels = models.length === 1 ? [models] : [models, [fallbackModel]]
  const providerDeadline = Date.now() + PROVIDER_TIMEOUT_MS

  for (const [attemptIndex, currentModels] of attemptModels.entries()) {
    const remainingMs = providerDeadline - Date.now()
    if (remainingMs <= 0) break

    let providerResponse: Response
    try {
      providerResponse = await (dependencies.fetcher ?? fetch)(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          'http-referer': dependencies.getEnvironment('TALLY_PUBLIC_URL')?.trim()
            || 'https://pengfanz.github.io/splitbill/',
          'x-title': 'Tally receipt splitting',
        },
        body: JSON.stringify(buildReceiptOpenRouterRequest(
          parsedRequest,
          currentModels,
          attemptIndex === 0 ? 'json-schema' : 'json-object',
        )),
        signal: AbortSignal.timeout(remainingMs),
      })
    } catch {
      dependencies.reportProviderFailure?.({ models: currentModels, status: 503, errorType: 'network' })
      return jsonError(503, 'provider_unavailable', 'The receipt AI service could not be reached.')
    }

    let providerPayload: unknown
    try {
      providerPayload = JSON.parse(await readTextWithLimit(providerResponse.body, MAX_PROVIDER_RESPONSE_BYTES))
    } catch {
      dependencies.reportProviderFailure?.({
        models: currentModels,
        status: providerResponse.status,
        errorType: 'unreadable_response',
      })
      return jsonError(502, 'provider_error', 'The AI provider returned unreadable receipt data.')
    }
    const embeddedFailure = getOpenRouterFailure(providerPayload)
    if (!providerResponse.ok || embeddedFailure) {
      const status = embeddedFailure?.status ?? providerResponse.status
      const errorType = embeddedFailure?.errorType ?? null
      dependencies.reportProviderFailure?.({ models: currentModels, status, errorType })
      return providerFailureResponse(status, errorType)
    }

    const actualModel = isRecord(providerPayload) && typeof providerPayload.model === 'string'
      ? providerPayload.model
      : currentModels[0]
    try {
      const result = (dependencies.parseProviderOutput ?? parseOpenRouterReceiptOutput)(providerPayload)
      return Response.json({ result, model: actualModel }, {
        headers: { 'cache-control': 'no-store' },
      })
    } catch (error) {
      const outputError = error instanceof ReceiptModelOutputError
        ? error
        : new ReceiptModelOutputError('schema_validation')
      dependencies.reportModelOutputFailure?.({
        models: currentModels,
        model: actualModel,
        attempt: attemptIndex + 1,
        reason: outputError.reason,
        issues: outputError.issues,
      })
    }
  }

  return jsonError(422, 'invalid_model_response', 'Tally could not safely understand this receipt. Retake the photo or enter it manually.')
}
