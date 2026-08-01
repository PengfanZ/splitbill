import { describe, expect, it, vi } from 'vitest'
import type { AiExpenseModelOutput } from './aiExpenseContract'
import { DEFAULT_OPENROUTER_MODEL } from './aiExpensePrompt'
import { handleParseExpenseRequest, type ParseExpenseHandlerDependencies } from './parseExpenseHandler'

const requestBody = {
  text: 'Maya paid $30 for dinner, split with me',
  locale: 'en',
  currency: 'USD',
  members: [{ id: 'me', name: 'Alex' }, { id: 'maya', name: 'Maya' }],
}

const output: AiExpenseModelOutput = {
  status: 'ready',
  title: 'Dinner',
  amountCents: 3000,
  payerId: 'maya',
  splitMethod: 'equal',
  participantIds: ['me', 'maya'],
  exactSharesCents: [],
  clarificationQuestion: null,
}

function providerResponse(modelOutput: unknown = output, status = 200) {
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(modelOutput) } }],
  }), { status })
}

function request(body: unknown = requestBody, headers: HeadersInit = {}) {
  return new Request('https://preview.supabase.co/functions/v1/parse-expense', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

function dependencies(overrides: Partial<ParseExpenseHandlerDependencies> = {}) {
  const environment: Record<string, string> = {
    AI_EXPENSE_ENABLED: 'true',
    OPENROUTER_API_KEY: 'secret-key',
  }
  return {
    consumeQuota: vi.fn().mockResolvedValue(true),
    fetcher: vi.fn().mockResolvedValue(providerResponse()),
    getEnvironment: vi.fn((name: string) => environment[name]),
    ...overrides,
  } satisfies ParseExpenseHandlerDependencies
}

describe('parse expense Edge Function handler', () => {
  it('rejects unsupported methods and oversized requests before using secrets', async () => {
    const deps = dependencies()
    const getResponse = await handleParseExpenseRequest(new Request('https://example.com', { method: 'GET' }), deps)
    expect(getResponse.status).toBe(405)
    expect(await getResponse.json()).toMatchObject({ code: 'method_not_allowed' })

    const largeResponse = await handleParseExpenseRequest(request(requestBody, { 'content-length': String(33 * 1024) }), deps)
    expect(largeResponse.status).toBe(413)
    expect(await largeResponse.json()).toMatchObject({ code: 'request_too_large' })
    expect(deps.consumeQuota).not.toHaveBeenCalled()
  })

  it('fails closed when disabled or missing its server-side key', async () => {
    const disabled = dependencies({ getEnvironment: () => undefined })
    const disabledResponse = await handleParseExpenseRequest(request(), disabled)
    expect(disabledResponse.status).toBe(503)
    expect(await disabledResponse.json()).toMatchObject({ code: 'ai_disabled' })

    const noKey = dependencies({ getEnvironment: name => name === 'AI_EXPENSE_ENABLED' ? 'true' : undefined })
    const noKeyResponse = await handleParseExpenseRequest(request(), noKey)
    expect(noKeyResponse.status).toBe(503)
    expect(await noKeyResponse.json()).toMatchObject({ code: 'ai_not_configured' })
  })

  it('rejects malformed JSON and invalid activity context', async () => {
    const deps = dependencies()
    const malformed = new Request('https://example.com', { method: 'POST', body: '{' })
    expect((await handleParseExpenseRequest(malformed, deps)).status).toBe(400)
    const invalid = await handleParseExpenseRequest(request({ ...requestBody, members: [] }), deps)
    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toMatchObject({ code: 'invalid_request' })
  })

  it('enforces the server quota using a normalized client identifier', async () => {
    const consumeQuota = vi.fn().mockResolvedValue(false)
    const response = await handleParseExpenseRequest(request(requestBody, {
      'cf-connecting-ip': ' 203.0.113.8 ',
    }), dependencies({ consumeQuota }))
    expect(response.status).toBe(429)
    expect(consumeQuota).toHaveBeenCalledWith('203.0.113.8')

    const forwardedQuota = vi.fn().mockResolvedValue(false)
    await handleParseExpenseRequest(request(requestBody, { 'x-forwarded-for': '198.51.100.4, 10.0.0.1' }), dependencies({ consumeQuota: forwardedQuota }))
    expect(forwardedQuota).toHaveBeenCalledWith('198.51.100.4')

    const unknownQuota = vi.fn().mockResolvedValue(false)
    await handleParseExpenseRequest(request(), dependencies({ consumeQuota: unknownQuota }))
    expect(unknownQuota).toHaveBeenCalledWith('unknown-client')

    const blankQuota = vi.fn().mockResolvedValue(false)
    await handleParseExpenseRequest(request(requestBody, { 'cf-connecting-ip': ' ' }), dependencies({ consumeQuota: blankQuota }))
    expect(blankQuota).toHaveBeenCalledWith('unknown-client')
  })

  it('fails closed when the quota service is unavailable', async () => {
    const response = await handleParseExpenseRequest(request(), dependencies({
      consumeQuota: vi.fn().mockRejectedValue(new Error('database offline')),
    }))
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ code: 'rate_limit_unavailable' })
  })

  it('returns an instant clarification before consuming quota or calling the provider', async () => {
    const deps = dependencies()
    const response = await handleParseExpenseRequest(request({ ...requestBody, text: 'dinner' }), deps)

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({
      result: {
        status: 'needs_clarification',
        question: 'Please add the total amount, who paid, and who should be included in the split.',
      },
      model: null,
    })
    expect(deps.consumeQuota).not.toHaveBeenCalled()
    expect(deps.fetcher).not.toHaveBeenCalled()
  })

  it('returns a validated draft and sends no provider fallback request', async () => {
    const fetcher = vi.fn().mockResolvedValue(providerResponse())
    const response = await handleParseExpenseRequest(request(), dependencies({ fetcher }))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({
      result: {
        status: 'ready',
        title: 'Dinner',
        amountCents: 3000,
        payerId: 'maya',
        splitMethod: 'equal',
        participantIds: ['me', 'maya'],
        exactSharesCents: [],
      },
      model: DEFAULT_OPENROUTER_MODEL,
    })
    const init = fetcher.mock.calls[0][1] as RequestInit
    const body = JSON.parse(init.body as string)
    expect(body.provider).toMatchObject({ allow_fallbacks: false, data_collection: 'deny', sort: 'latency' })
    expect(init.headers).toMatchObject({ authorization: 'Bearer secret-key' })
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('uses the runtime fetch implementation when no test fetcher is provided', async () => {
    const runtimeFetch = vi.fn().mockResolvedValue(providerResponse())
    vi.stubGlobal('fetch', runtimeFetch)
    const response = await handleParseExpenseRequest(request(), dependencies({ fetcher: undefined }))
    expect(response.status).toBe(200)
    expect(runtimeFetch).toHaveBeenCalledOnce()
    vi.unstubAllGlobals()
  })

  it('uses a configured model and supports safe clarification results', async () => {
    const clarification = { ...output, status: 'needs_clarification', clarificationQuestion: 'Who paid?' }
    const response = await handleParseExpenseRequest(request(), dependencies({
      getEnvironment: name => ({
        AI_EXPENSE_ENABLED: 'true',
        OPENROUTER_API_KEY: 'secret-key',
        OPENROUTER_MODEL: 'google/gemma-free',
      })[name],
      fetcher: vi.fn().mockResolvedValue(providerResponse(clarification)),
    }))
    expect(await response.json()).toEqual({
      result: { status: 'needs_clarification', question: 'Who paid?' },
      model: 'google/gemma-free',
    })
  })

  it.each([
    [429, 'provider_rate_limit', 429],
    [500, 'provider_error', 502],
  ])('maps provider status %s to %s', async (providerStatus, code, expectedStatus) => {
    const response = await handleParseExpenseRequest(request(), dependencies({
      fetcher: vi.fn().mockResolvedValue(new Response('{}', { status: providerStatus })),
    }))
    expect(response.status).toBe(expectedStatus)
    expect(await response.json()).toMatchObject({ code })
  })

  it('handles provider network and response failures without leaking content', async () => {
    const unavailable = await handleParseExpenseRequest(request(), dependencies({
      fetcher: vi.fn().mockRejectedValue(new Error('secret provider detail')),
    }))
    expect(unavailable.status).toBe(503)
    expect(await unavailable.text()).not.toContain('secret provider detail')

    const unreadable = await handleParseExpenseRequest(request(), dependencies({
      fetcher: vi.fn().mockResolvedValue(new Response('{', { status: 200 })),
    }))
    expect(unreadable.status).toBe(502)
    expect(await unreadable.json()).toMatchObject({ code: 'provider_error' })

    const invalid = await handleParseExpenseRequest(request(), dependencies({
      fetcher: vi.fn().mockResolvedValue(providerResponse({ ...output, payerId: 'invented' })),
    }))
    expect(invalid.status).toBe(502)
    expect(await invalid.json()).toMatchObject({ code: 'invalid_model_response' })
  })
})
