import { describe, expect, it, vi } from 'vitest'
import type { AiExpenseBatchModelOutput, AiExpenseModelOutput } from './aiExpenseContract'
import {
  DEFAULT_OPENROUTER_FALLBACK_MODEL,
  DEFAULT_OPENROUTER_MODEL,
  DEFAULT_OPENROUTER_VOICE_MODEL,
} from './aiExpensePrompt'
import {
  AI_EXPENSE_CORS_HEADERS,
  handleParseExpenseRequest,
  type ParseExpenseHandlerDependencies,
} from './parseExpenseHandler'
import { encodePcm16Wav } from './voiceRecording'

const requestBody = {
  text: 'Maya paid $30 for dinner, split with me',
  locale: 'en',
  currency: 'USD',
  members: [{ id: 'me', name: 'Alex' }, { id: 'maya', name: 'Maya' }],
  viewerMemberId: 'me',
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

const batchOutput: AiExpenseBatchModelOutput = {
  status: 'ready',
  expenses: [
    {
      title: 'Lunch',
      amountCents: 2000,
      payerId: 'me',
      splitMethod: 'equal',
      participantIds: ['me', 'maya'],
      exactSharesCents: [],
    },
    {
      title: 'Groceries',
      amountCents: 4600,
      payerId: 'maya',
      splitMethod: 'exact',
      participantIds: ['me', 'maya'],
      exactSharesCents: [
        { memberId: 'me', amountCents: 2300 },
        { memberId: 'maya', amountCents: 2300 },
      ],
    },
  ],
  clarificationQuestion: null,
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

const voiceBody = {
  inputMode: 'voice',
  audio: {
    data: bytesToBase64(encodePcm16Wav(new Float32Array(16_000))),
    format: 'wav',
    durationSeconds: 1,
  },
  locale: 'en',
  currency: 'USD',
  members: requestBody.members,
  viewerMemberId: 'me',
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
    reportProviderFailure: vi.fn(),
    ...overrides,
  } satisfies ParseExpenseHandlerDependencies
}

describe('parse expense Edge Function handler', () => {
  it('allows the client input-mode header in browser preflight requests', () => {
    expect(AI_EXPENSE_CORS_HEADERS).toEqual({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': expect.stringContaining('x-tally-input-mode'),
    })
  })

  it('rejects unsupported methods and oversized requests before using secrets', async () => {
    const deps = dependencies()
    const getResponse = await handleParseExpenseRequest(new Request('https://example.com', { method: 'GET' }), deps)
    expect(getResponse.status).toBe(405)
    expect(await getResponse.json()).toMatchObject({ code: 'method_not_allowed' })

    const largeResponse = await handleParseExpenseRequest(request(requestBody, { 'content-length': String(33 * 1024) }), deps)
    expect(largeResponse.status).toBe(413)
    expect(await largeResponse.json()).toMatchObject({ code: 'request_too_large' })
    expect(deps.consumeQuota).not.toHaveBeenCalled()

    const streamedLargeResponse = await handleParseExpenseRequest(request({
      ...requestBody,
      text: 'x'.repeat(33 * 1024),
    }), deps)
    expect(streamedLargeResponse.status).toBe(413)

    const invalidModeResponse = await handleParseExpenseRequest(request(requestBody, {
      'x-tally-input-mode': 'video',
    }), deps)
    expect(invalidModeResponse.status).toBe(400)
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
    expect((await handleParseExpenseRequest(new Request('https://example.com', { method: 'POST' }), deps)).status).toBe(400)
    expect((await handleParseExpenseRequest(request(requestBody, { 'x-tally-input-mode': 'voice' }), deps)).status).toBe(400)
  })

  it('validates voice audio, consumes the voice quota, and uses the audio-capable model', async () => {
    const deps = dependencies()
    const response = await handleParseExpenseRequest(request(voiceBody, {
      'x-tally-input-mode': 'voice',
      'cf-connecting-ip': '203.0.113.9',
    }), deps)
    expect(response.status).toBe(200)
    expect(deps.consumeQuota).toHaveBeenCalledWith('203.0.113.9', 'voice')
    const init = vi.mocked(deps.fetcher! as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit
    const body = JSON.parse(init.body as string)
    expect(body.models).toEqual([DEFAULT_OPENROUTER_VOICE_MODEL])
    expect(body.messages[1].content[1]).toMatchObject({
      type: 'input_audio',
      input_audio: { format: 'wav' },
    })
    expect(body.messages[1].content[1].input_audio).not.toHaveProperty('durationSeconds')

    const customFetcher = vi.fn().mockResolvedValue(providerResponse())
    await handleParseExpenseRequest(request(voiceBody, { 'x-tally-input-mode': 'voice' }), dependencies({
      getEnvironment: name => ({
        AI_EXPENSE_ENABLED: 'true',
        OPENROUTER_API_KEY: 'secret-key',
        OPENROUTER_VOICE_MODEL: 'google/voice-primary',
        OPENROUTER_VOICE_FALLBACK_MODEL: 'google/voice-backup',
      })[name],
      fetcher: customFetcher,
    }))
    expect(JSON.parse((customFetcher.mock.calls[0][1] as RequestInit).body as string).models)
      .toEqual(['google/voice-primary', 'google/voice-backup'])
  })

  it('rejects malformed voice audio before quota or model usage', async () => {
    const deps = dependencies()
    const response = await handleParseExpenseRequest(request({
      ...voiceBody,
      audio: { ...voiceBody.audio, data: 'A'.repeat(64) },
    }, { 'x-tally-input-mode': 'voice' }), deps)
    expect(response.status).toBe(400)
    expect(deps.consumeQuota).not.toHaveBeenCalled()
    expect(deps.fetcher).not.toHaveBeenCalled()
  })

  it('enforces the server quota using a normalized client identifier', async () => {
    const consumeQuota = vi.fn().mockResolvedValue(false)
    const response = await handleParseExpenseRequest(request(requestBody, {
      'cf-connecting-ip': ' 203.0.113.8 ',
    }), dependencies({ consumeQuota }))
    expect(response.status).toBe(429)
    expect(consumeQuota).toHaveBeenCalledWith('203.0.113.8', 'text')

    const forwardedQuota = vi.fn().mockResolvedValue(false)
    await handleParseExpenseRequest(request(requestBody, { 'x-forwarded-for': '198.51.100.4, 10.0.0.1' }), dependencies({ consumeQuota: forwardedQuota }))
    expect(forwardedQuota).toHaveBeenCalledWith('198.51.100.4', 'text')

    const unknownQuota = vi.fn().mockResolvedValue(false)
    await handleParseExpenseRequest(request(), dependencies({ consumeQuota: unknownQuota }))
    expect(unknownQuota).toHaveBeenCalledWith('unknown-client', 'text')

    const blankQuota = vi.fn().mockResolvedValue(false)
    await handleParseExpenseRequest(request(requestBody, { 'cf-connecting-ip': ' ' }), dependencies({ consumeQuota: blankQuota }))
    expect(blankQuota).toHaveBeenCalledWith('unknown-client', 'text')
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

  it('returns a validated draft and sends a free-first, low-cost fallback request', async () => {
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
    expect(body.models).toEqual([DEFAULT_OPENROUTER_MODEL, DEFAULT_OPENROUTER_FALLBACK_MODEL])
    expect(JSON.parse(body.messages[1].content)).toMatchObject({ currentMemberId: 'me' })
    expect(body).not.toHaveProperty('model')
    expect(body.provider).toMatchObject({ allow_fallbacks: true, data_collection: 'deny' })
    expect(init.headers).toMatchObject({ authorization: 'Bearer secret-key' })
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('returns a complete ordered batch for new clients while preserving the legacy response path', async () => {
    const fetcher = vi.fn().mockResolvedValue(providerResponse(batchOutput))
    const response = await handleParseExpenseRequest(request({
      ...requestBody,
      text: 'I paid $20 for lunch and Maya paid $46 for groceries. Split both between us.',
      responseMode: 'batch',
    }), dependencies({ fetcher }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      result: {
        status: 'ready_batch',
        drafts: [
          expect.objectContaining({ title: 'Lunch', amountCents: 2000 }),
          expect.objectContaining({ title: 'Groceries', amountCents: 4600, splitMethod: 'exact' }),
        ],
      },
      model: DEFAULT_OPENROUTER_MODEL,
    })
    const body = JSON.parse((fetcher.mock.calls[0][1] as RequestInit).body as string)
    expect(body.max_tokens).toBe(8_000)
    expect(body.response_format.json_schema.name).toBe('tally_expense_batch')
    expect(body.response_format.json_schema.schema.properties.expenses).not.toHaveProperty('maxItems')
    expect(JSON.parse(body.messages[1].content)).toMatchObject({ responseMode: 'batch' })
  })

  it('turns an unsafe partial batch into one clarification instead of saving partial drafts', async () => {
    const partial = {
      ...batchOutput,
      status: 'needs_clarification',
      clarificationQuestion: 'Who paid for groceries?',
    }
    const response = await handleParseExpenseRequest(request({
      ...requestBody,
      responseMode: 'batch',
    }), dependencies({ fetcher: vi.fn().mockResolvedValue(providerResponse(partial)) }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      result: {
        status: 'needs_clarification',
        question: 'I could not determine these expenses safely. Please provide the missing amount, payer, or participants for each expense.',
      },
      model: DEFAULT_OPENROUTER_MODEL,
    })
  })

  it('uses the runtime fetch implementation when no test fetcher is provided', async () => {
    const runtimeFetch = vi.fn().mockResolvedValue(providerResponse())
    vi.stubGlobal('fetch', runtimeFetch)
    const response = await handleParseExpenseRequest(request(), dependencies({ fetcher: undefined }))
    expect(response.status).toBe(200)
    expect(runtimeFetch).toHaveBeenCalledOnce()
    vi.unstubAllGlobals()
  })

  it('uses configured primary and fallback models and reports the model that answered', async () => {
    const clarification = { ...output, status: 'needs_clarification', clarificationQuestion: 'Who paid?' }
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      model: 'google/paid-backup',
      choices: [{ message: { content: JSON.stringify(clarification) } }],
    })))
    const response = await handleParseExpenseRequest(request(), dependencies({
      getEnvironment: name => ({
        AI_EXPENSE_ENABLED: 'true',
        OPENROUTER_API_KEY: 'secret-key',
        OPENROUTER_MODEL: 'google/gemma-free',
        OPENROUTER_FALLBACK_MODEL: 'google/paid-backup',
      })[name],
      fetcher,
    }))
    expect(await response.json()).toEqual({
      result: { status: 'needs_clarification', question: 'Who paid?' },
      model: 'google/paid-backup',
    })
    const body = JSON.parse((fetcher.mock.calls[0][1] as RequestInit).body as string)
    expect(body.models).toEqual(['google/gemma-free', 'google/paid-backup'])
  })

  it('deduplicates identical configured primary and fallback models', async () => {
    const fetcher = vi.fn().mockResolvedValue(providerResponse())
    await handleParseExpenseRequest(request(), dependencies({
      getEnvironment: name => ({
        AI_EXPENSE_ENABLED: 'true',
        OPENROUTER_API_KEY: 'secret-key',
        OPENROUTER_MODEL: 'one-model',
        OPENROUTER_FALLBACK_MODEL: 'one-model',
      })[name],
      fetcher,
    }))
    const body = JSON.parse((fetcher.mock.calls[0][1] as RequestInit).body as string)
    expect(body.models).toEqual(['one-model'])
  })

  it.each([
    [402, 'provider_payment_required', 503],
    [429, 'provider_rate_limit', 429],
    [500, 'provider_error', 502],
    [502, 'model_unavailable', 503],
    [503, 'model_unavailable', 503],
    [504, 'model_unavailable', 503],
  ])('maps provider status %s to %s', async (providerStatus, code, expectedStatus) => {
    const reportProviderFailure = vi.fn()
    const response = await handleParseExpenseRequest(request(), dependencies({
      fetcher: vi.fn().mockResolvedValue(new Response('{}', { status: providerStatus })),
      reportProviderFailure,
    }))
    expect(response.status).toBe(expectedStatus)
    expect(await response.json()).toMatchObject({ code })
    expect(reportProviderFailure).toHaveBeenCalledWith({
      models: [DEFAULT_OPENROUTER_MODEL, DEFAULT_OPENROUTER_FALLBACK_MODEL],
      status: providerStatus,
      errorType: null,
    })
  })

  it('recognizes provider failures embedded in an HTTP 200 completion', async () => {
    const reportProviderFailure = vi.fn()
    const response = await handleParseExpenseRequest(request(), dependencies({
      fetcher: vi.fn().mockResolvedValue(new Response(JSON.stringify({
        choices: [{
          finish_reason: 'error',
          error: {
            code: 502,
            message: 'secret upstream detail',
            metadata: { error_type: 'provider_unavailable' },
          },
        }],
      }))),
      reportProviderFailure,
    }))
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ code: 'model_unavailable' })
    expect(reportProviderFailure).toHaveBeenCalledWith(expect.objectContaining({
      status: 502,
      errorType: 'provider_unavailable',
    }))
    expect(JSON.stringify(reportProviderFailure.mock.calls)).not.toContain('secret upstream detail')
  })

  it('handles provider network and unreadable response failures without leaking content', async () => {
    const networkReporter = vi.fn()
    const unavailable = await handleParseExpenseRequest(request(), dependencies({
      fetcher: vi.fn().mockRejectedValue(new Error('secret provider detail')),
      reportProviderFailure: networkReporter,
    }))
    expect(unavailable.status).toBe(503)
    expect(await unavailable.text()).not.toContain('secret provider detail')
    expect(networkReporter).toHaveBeenCalledWith(expect.objectContaining({ errorType: 'network' }))

    const unreadableReporter = vi.fn()
    const unreadable = await handleParseExpenseRequest(request(), dependencies({
      fetcher: vi.fn().mockResolvedValue(new Response('{', { status: 200 })),
      reportProviderFailure: unreadableReporter,
    }))
    expect(unreadable.status).toBe(502)
    expect(await unreadable.json()).toMatchObject({ code: 'provider_error' })
    expect(unreadableReporter).toHaveBeenCalledWith(expect.objectContaining({ errorType: 'unreadable_response' }))

  })

  it('turns unsafe model drafts into actionable clarification instead of an availability error', async () => {
    const invalid = await handleParseExpenseRequest(request(), dependencies({
      fetcher: vi.fn().mockResolvedValue(providerResponse({ ...output, payerId: 'invented' })),
    }))
    expect(invalid.status).toBe(200)
    expect(await invalid.json()).toEqual({
      result: {
        status: 'needs_clarification',
        question: 'I could not determine this expense safely. Please add the total amount, who paid, and who should be included in the split.',
      },
      model: DEFAULT_OPENROUTER_MODEL,
    })

    const malformedModel = await handleParseExpenseRequest(request(), dependencies({
      fetcher: vi.fn().mockResolvedValue(providerResponse({ status: 'ready' })),
    }))
    expect(malformedModel.status).toBe(200)
    expect(await malformedModel.json()).toMatchObject({
      result: { status: 'needs_clarification' },
    })

    const repeated = await handleParseExpenseRequest(request({
      ...requestBody,
      clarification: { question: 'Who paid?', answer: 'Maya paid.' },
    }), dependencies({
      fetcher: vi.fn().mockResolvedValue(providerResponse({ ...output, payerId: 'invented' })),
    }))
    expect(repeated.status).toBe(200)
    expect(await repeated.json()).toMatchObject({
      result: {
        status: 'needs_clarification',
        question: expect.stringContaining('rewrite the complete expense'),
      },
    })
  })
})
