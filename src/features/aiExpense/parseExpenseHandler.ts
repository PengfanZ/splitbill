import {
  normalizeAiExpenseModelOutput,
  parseAiExpenseRequest,
} from './aiExpenseContract.ts'
import {
  buildOpenRouterRequest,
  DEFAULT_OPENROUTER_MODEL,
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
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const MAX_REQUEST_BYTES = 32 * 1024

function jsonError(status: number, code: string, message: string) {
  return Response.json({ code, message }, {
    status,
    headers: { 'cache-control': 'no-store' },
  })
}

function requestIdentifier(request: Request) {
  const forwarded = request.headers.get('cf-connecting-ip')
    ?? request.headers.get('x-forwarded-for')?.split(',')[0]
    ?? 'unknown-client'
  return forwarded.trim().slice(0, 200) || 'unknown-client'
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
      body: JSON.stringify(buildOpenRouterRequest(parsedRequest, model)),
      signal: AbortSignal.timeout(20_000),
    })
  } catch {
    return jsonError(503, 'provider_unavailable', 'The AI provider could not be reached.')
  }

  if (providerResponse.status === 429) {
    return jsonError(429, 'provider_rate_limit', 'The free AI model is busy. Try again shortly.')
  }
  if (!providerResponse.ok) {
    return jsonError(502, 'provider_error', 'The AI provider could not create a draft.')
  }

  let providerPayload: unknown
  try {
    providerPayload = await providerResponse.json()
  } catch {
    return jsonError(502, 'provider_error', 'The AI provider returned unreadable data.')
  }

  try {
    const modelOutput = parseOpenRouterModelOutput(providerPayload)
    const result = normalizeAiExpenseModelOutput(modelOutput, parsedRequest)
    return Response.json({ result, model }, {
      headers: { 'cache-control': 'no-store' },
    })
  } catch {
    return Response.json({
      result: {
        status: 'needs_clarification',
        question: getAiExpenseRecoveryQuestion(parsedRequest),
      },
      model,
    }, { headers: { 'cache-control': 'no-store' } })
  }
}
