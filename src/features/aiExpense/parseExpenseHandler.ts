import {
  normalizeAiExpenseModelOutput,
  parseAiExpenseRequest,
} from './aiExpenseContract.ts'
import {
  buildOpenRouterRequest,
  DEFAULT_OPENROUTER_FALLBACK_MODEL,
  DEFAULT_OPENROUTER_MODEL,
  getOpenRouterFailure,
  parseOpenRouterModelOutput,
} from './aiExpensePrompt.ts'
import {
  getAiExpensePreflightQuestion,
  getAiExpenseRecoveryQuestion,
} from './aiExpensePreflight.ts'

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export type ParseExpenseHandlerDependencies = {
  consumeQuota: (identifier: string) => Promise<boolean>
  fetcher?: Fetcher
  getEnvironment: (name: string) => string | undefined
  reportProviderFailure?: (failure: {
    models: string[]
    status: number
    errorType: string | null
  }) => void
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const MAX_REQUEST_BYTES = 32 * 1024

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
  const forwarded = request.headers.get('cf-connecting-ip')
    ?? request.headers.get('x-forwarded-for')?.split(',')[0]
    ?? 'unknown-client'
  return forwarded.trim().slice(0, 200) || 'unknown-client'
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

export async function handleParseExpenseRequest(
  request: Request,
  dependencies: ParseExpenseHandlerDependencies,
) {
  if (request.method !== 'POST') {
    return jsonError(405, 'method_not_allowed', 'Use POST to create an expense draft.')
  }

  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
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
    parsedRequest = parseAiExpenseRequest(await request.json())
  } catch {
    return jsonError(400, 'invalid_request', 'Describe one expense using the current activity members.')
  }

  const preflightQuestion = getAiExpensePreflightQuestion(parsedRequest)
  if (preflightQuestion) {
    return Response.json({
      result: { status: 'needs_clarification', question: preflightQuestion },
      model: null,
    }, { headers: { 'cache-control': 'no-store' } })
  }

  try {
    if (!await dependencies.consumeQuota(requestIdentifier(request))) {
      return jsonError(429, 'rate_limit_exceeded', 'Too many AI requests. Try again in a few minutes.')
    }
  } catch {
    return jsonError(503, 'rate_limit_unavailable', 'AI expense entry is temporarily unavailable.')
  }

  const model = dependencies.getEnvironment('OPENROUTER_MODEL')?.trim() || DEFAULT_OPENROUTER_MODEL
  const fallbackModel = dependencies.getEnvironment('OPENROUTER_FALLBACK_MODEL')?.trim()
    || DEFAULT_OPENROUTER_FALLBACK_MODEL
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
    const modelOutput = parseOpenRouterModelOutput(providerPayload)
    const result = normalizeAiExpenseModelOutput(modelOutput, parsedRequest)
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
