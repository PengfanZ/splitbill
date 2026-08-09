import {
  isBatchAiExpenseRequest,
  normalizeAiExpenseBatchModelOutput,
  normalizeAiExpenseModelOutput,
  parseAiExpenseRequest,
  isVoiceAiExpenseRequest,
} from './aiExpenseContract.ts'
import {
  buildOpenRouterRequest,
  DEFAULT_OPENROUTER_FALLBACK_MODEL,
  DEFAULT_OPENROUTER_MODEL,
  DEFAULT_OPENROUTER_VOICE_MODEL,
  getOpenRouterFailure,
  parseOpenRouterBatchModelOutput,
  parseOpenRouterModelOutput,
} from './aiExpensePrompt.ts'
import {
  getAiExpensePreflightQuestion,
  getAiExpenseRecoveryQuestion,
} from './aiExpensePreflight.ts'
import { validateVoiceWav } from './voiceAudio.ts'

export const AI_EXPENSE_CORS_HEADERS = {
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

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export type ParseExpenseHandlerDependencies = {
  consumeQuota: (identifier: string, inputMode: 'text' | 'voice') => Promise<AiExpenseQuotaResult>
  fetcher?: Fetcher
  getEnvironment: (name: string) => string | undefined
  reportProviderFailure?: (failure: {
    models: string[]
    status: number
    errorType: string | null
  }) => void
}

export type AiExpenseQuotaResult = 'allowed' | 'client-limit' | 'global-limit'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const MAX_TEXT_REQUEST_BYTES = 32 * 1024
const MAX_VOICE_REQUEST_BYTES = 3 * 1024 * 1024

function jsonError(status: number, code: string, message: string) {
  return Response.json({ code, message }, {
    status,
    headers: { 'cache-control': 'no-store' },
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

function providerFailureResponse(status: number, errorType: string | null) {
  if (status === 402 || errorType === 'payment_required') {
    return jsonError(503, 'provider_payment_required', 'AI provider credits are currently unavailable.')
  }
  if (status === 429 || errorType === 'rate_limit_exceeded') {
    return jsonError(429, 'provider_rate_limit', 'The configured AI models are busy. Try again shortly.')
  }
  if ([408, 502, 503, 504].includes(status)
    || ['provider_overloaded', 'provider_unavailable', 'timeout'].includes(errorType ?? '')) {
    return jsonError(503, 'model_unavailable', 'The configured AI models could not respond.')
  }
  return jsonError(502, 'provider_error', 'The AI provider could not create a draft.')
}

async function readJsonWithLimit(request: Request, maxBytes: number) {
  if (!request.body) throw new Error('Missing request body.')
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new RangeError('Request too large.')
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown
}

export async function handleParseExpenseRequest(
  request: Request,
  dependencies: ParseExpenseHandlerDependencies,
) {
  if (request.method !== 'POST') {
    return jsonError(405, 'method_not_allowed', 'Use POST to create an expense draft.')
  }

  const requestedMode = request.headers.get('x-tally-input-mode') ?? 'text'
  if (requestedMode !== 'text' && requestedMode !== 'voice') {
    return jsonError(400, 'invalid_request', 'Choose text or voice expense entry.')
  }
  const maxRequestBytes = requestedMode === 'voice' ? MAX_VOICE_REQUEST_BYTES : MAX_TEXT_REQUEST_BYTES
  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (Number.isFinite(contentLength) && contentLength > maxRequestBytes) {
    return jsonError(413, 'request_too_large', 'The expense description is too large.')
  }

  if (dependencies.getEnvironment('AI_EXPENSE_ENABLED') !== 'true') {
    return jsonError(503, 'ai_disabled', 'AI expense entry is currently disabled.')
  }
  const apiKey = dependencies.getEnvironment('OPENROUTER_API_KEY')?.trim() ?? ''
  if (!apiKey) {
    return jsonError(503, 'ai_not_configured', 'AI expense entry is not configured.')
  }

  let parsedRequest
  try {
    parsedRequest = parseAiExpenseRequest(await readJsonWithLimit(request, maxRequestBytes))
    if (parsedRequest.inputMode !== requestedMode) throw new Error('Input mode mismatch.')
    if (isVoiceAiExpenseRequest(parsedRequest)) validateVoiceWav(parsedRequest.audio)
  } catch (error) {
    if (error instanceof RangeError) {
      return jsonError(413, 'request_too_large', 'The expense description is too large.')
    }
    return jsonError(400, 'invalid_request', 'Describe one or more expenses using the current activity members.')
  }

  const preflightQuestion = isVoiceAiExpenseRequest(parsedRequest)
    ? null
    : getAiExpensePreflightQuestion(parsedRequest)
  if (preflightQuestion) {
    return Response.json({
      result: { status: 'needs_clarification', question: preflightQuestion },
      model: null,
    }, { headers: { 'cache-control': 'no-store' } })
  }

  try {
    const quota = await dependencies.consumeQuota(requestIdentifier(request), parsedRequest.inputMode)
    if (quota === 'client-limit') {
      return jsonError(429, 'rate_limit_exceeded', 'Too many AI requests. Try again in a few minutes.')
    }
    if (quota === 'global-limit') {
      return jsonError(503, 'ai_budget_exceeded', 'The project AI budget is temporarily unavailable.')
    }
  } catch {
    return jsonError(503, 'rate_limit_unavailable', 'AI expense entry is temporarily unavailable.')
  }

  const voiceRequest = isVoiceAiExpenseRequest(parsedRequest)
  const model = voiceRequest
    ? dependencies.getEnvironment('OPENROUTER_VOICE_MODEL')?.trim() || DEFAULT_OPENROUTER_VOICE_MODEL
    : dependencies.getEnvironment('OPENROUTER_MODEL')?.trim() || DEFAULT_OPENROUTER_MODEL
  const fallbackModel = voiceRequest
    ? dependencies.getEnvironment('OPENROUTER_VOICE_FALLBACK_MODEL')?.trim() || DEFAULT_OPENROUTER_VOICE_MODEL
    : dependencies.getEnvironment('OPENROUTER_FALLBACK_MODEL')?.trim() || DEFAULT_OPENROUTER_FALLBACK_MODEL
  const models = model === fallbackModel ? [model] : [model, fallbackModel]
  let providerResponse: Response
  try {
    providerResponse = await (dependencies.fetcher ?? fetch)(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        'http-referer': 'https://pengfanz.github.io/splitbill/',
        'x-title': 'Tally AI expense preview',
      },
      body: JSON.stringify(buildOpenRouterRequest(parsedRequest, model, fallbackModel)),
      signal: AbortSignal.timeout(20_000),
    })
  } catch {
    dependencies.reportProviderFailure?.({ models, status: 503, errorType: 'network' })
    return jsonError(503, 'provider_unavailable', 'The AI provider could not be reached.')
  }

  let providerPayload: unknown
  try {
    providerPayload = await providerResponse.json()
  } catch {
    dependencies.reportProviderFailure?.({ models, status: providerResponse.status, errorType: 'unreadable_response' })
    return jsonError(502, 'provider_error', 'The AI provider returned unreadable data.')
  }

  const embeddedFailure = getOpenRouterFailure(providerPayload)
  if (!providerResponse.ok || embeddedFailure) {
    const status = embeddedFailure?.status ?? providerResponse.status
    const errorType = embeddedFailure?.errorType ?? null
    dependencies.reportProviderFailure?.({ models, status, errorType })
    return providerFailureResponse(status, errorType)
  }

  const actualModel = isRecord(providerPayload) && typeof providerPayload.model === 'string'
    ? providerPayload.model
    : model

  try {
    const result = isBatchAiExpenseRequest(parsedRequest)
      ? normalizeAiExpenseBatchModelOutput(parseOpenRouterBatchModelOutput(providerPayload), parsedRequest)
      : normalizeAiExpenseModelOutput(parseOpenRouterModelOutput(providerPayload), parsedRequest)
    return Response.json({ result, model: actualModel }, {
      headers: { 'cache-control': 'no-store' },
    })
  } catch {
    return Response.json({
      result: {
        status: 'needs_clarification',
        question: getAiExpenseRecoveryQuestion(parsedRequest),
      },
      model: actualModel,
    }, { headers: { 'cache-control': 'no-store' } })
  }
}
