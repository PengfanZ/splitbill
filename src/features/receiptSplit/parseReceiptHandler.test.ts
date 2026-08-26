import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_RECEIPT_UPLOAD_BYTES } from './receiptContract'
import { receiptDraftFixture } from './receiptContract.test'
import {
  DEFAULT_OPENROUTER_RECEIPT_FALLBACK_MODEL,
  DEFAULT_OPENROUTER_RECEIPT_MODEL,
} from './receiptPrompt'
import {
  handleParseReceiptRequest,
  RECEIPT_CORS_HEADERS,
  type ParseReceiptHandlerDependencies,
} from './parseReceiptHandler'

const body = {
  image: { dataUrl: 'data:image/jpeg;base64,QQ==', width: 1, height: 1 },
  locale: 'en',
  currency: 'USD',
}

function request(value: unknown = body, headers: HeadersInit = {}) {
  return new Request('https://preview.supabase.co/functions/v1/parse-receipt', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-tally-input-mode': 'receipt', ...headers },
    body: JSON.stringify(value),
  })
}

function providerResponse(output: unknown = receiptDraftFixture, status = 200, model?: string) {
  return new Response(JSON.stringify({
    ...(model ? { model } : {}),
    choices: [{ message: { content: JSON.stringify(output) } }],
  }), { status })
}

function dependencies(overrides: Partial<ParseReceiptHandlerDependencies> = {}) {
  const environment: Record<string, string> = {
    AI_RECEIPT_ENABLED: 'true',
    OPENROUTER_API_KEY: 'secret-key',
  }
  return {
    consumeQuota: vi.fn().mockResolvedValue('allowed'),
    fetcher: vi.fn().mockResolvedValue(providerResponse()),
    getEnvironment: vi.fn((name: string) => environment[name]),
    reportModelOutputFailure: vi.fn(),
    reportProviderFailure: vi.fn(),
    ...overrides,
  } satisfies ParseReceiptHandlerDependencies
}

afterEach(() => vi.unstubAllGlobals())

describe('parse receipt Edge Function handler', () => {
  it('supports the receipt input header and rejects bad methods and modes', async () => {
    expect(RECEIPT_CORS_HEADERS['Access-Control-Allow-Headers']).toContain('x-tally-input-mode')
    const get = await handleParseReceiptRequest(new Request('https://example.com'), dependencies())
    expect(get.status).toBe(405)
    expect(await get.json()).toMatchObject({ code: 'method_not_allowed' })
    const badMode = await handleParseReceiptRequest(request(body, { 'x-tally-input-mode': 'text' }), dependencies())
    expect(badMode.status).toBe(400)
  })

  it('rejects oversized requests before quota and fails closed without configuration', async () => {
    const deps = dependencies()
    const tooLarge = await handleParseReceiptRequest(request(body, {
      'content-length': String(Math.ceil(MAX_RECEIPT_UPLOAD_BYTES * 4 / 3) + 3_000),
    }), deps)
    expect(tooLarge.status).toBe(413)
    expect(deps.consumeQuota).not.toHaveBeenCalled()

    const disabled = await handleParseReceiptRequest(request(), dependencies({ getEnvironment: () => undefined }))
    expect(await disabled.json()).toMatchObject({ code: 'ai_disabled' })
    const noKey = await handleParseReceiptRequest(request(), dependencies({
      getEnvironment: name => name === 'AI_RECEIPT_ENABLED' ? 'true' : undefined,
    }))
    expect(await noKey.json()).toMatchObject({ code: 'ai_not_configured' })
  })

  it('validates the upload before consuming quota and normalizes the IP', async () => {
    const consumeQuota = vi.fn().mockResolvedValue('allowed')
    const response = await handleParseReceiptRequest(new Request('https://example.com', {
      method: 'POST',
      headers: { 'x-tally-input-mode': 'receipt', 'cf-connecting-ip': ' 2001:db8::1 ' },
      body: '{',
    }), dependencies({ consumeQuota }))
    expect(response.status).toBe(400)
    expect(consumeQuota).not.toHaveBeenCalled()

    const validIp = vi.fn().mockResolvedValue('allowed')
    await handleParseReceiptRequest(request(body, { 'cf-connecting-ip': ' 2001:db8::1 ' }), dependencies({ consumeQuota: validIp }))
    expect(validIp).toHaveBeenCalledWith('2001:db8::1')

    const unknown = vi.fn().mockResolvedValue('client-limit')
    await handleParseReceiptRequest(request(body, { 'cf-connecting-ip': 'forged value' }), dependencies({ consumeQuota: unknown }))
    expect(unknown).toHaveBeenCalledWith('unknown-client')

    const tooLong = vi.fn().mockResolvedValue('client-limit')
    await handleParseReceiptRequest(request(body, { 'cf-connecting-ip': 'a'.repeat(65) }), dependencies({ consumeQuota: tooLong }))
    expect(tooLong).toHaveBeenCalledWith('unknown-client')
  })

  it('maps client, project, and quota-service limits', async () => {
    const client = await handleParseReceiptRequest(request(), dependencies({ consumeQuota: vi.fn().mockResolvedValue('client-limit') }))
    expect(client.status).toBe(429)
    expect(client.headers.get('retry-after')).toBe('600')
    expect(await client.json()).toMatchObject({ code: 'rate_limit_exceeded' })
    const global = await handleParseReceiptRequest(request(), dependencies({ consumeQuota: vi.fn().mockResolvedValue('global-limit') }))
    expect(await global.json()).toMatchObject({ code: 'ai_budget_exceeded' })
    const unavailable = await handleParseReceiptRequest(request(), dependencies({ consumeQuota: vi.fn().mockRejectedValue(new Error('db')) }))
    expect(await unavailable.json()).toMatchObject({ code: 'rate_limit_unavailable' })
  })

  it('validates JSON, image type, data, dimensions, and streamed size', async () => {
    expect((await handleParseReceiptRequest(request({}), dependencies())).status).toBe(400)
    expect((await handleParseReceiptRequest(request({ ...body, image: { ...body.image, dataUrl: 'data:image/gif;base64,QQ==' } }), dependencies())).status).toBe(400)
    expect((await handleParseReceiptRequest(request({ ...body, image: { ...body.image, dataUrl: 'data:image/jpeg;base64,' } }), dependencies())).status).toBe(400)
    expect((await handleParseReceiptRequest(request({ ...body, image: { ...body.image, width: 0 } }), dependencies())).status).toBe(400)
    expect((await handleParseReceiptRequest(request({ ...body, image: { ...body.image, dataUrl: 'data:image/jpeg;base64,A' } }), dependencies())).status).toBe(413)
    expect((await handleParseReceiptRequest(request({ ...body, image: { ...body.image, dataUrl: 'data:image/jpeg;base64,AAA=' } }), dependencies())).status).toBe(200)

    const encodedOverLimit = 'A'.repeat(Math.floor(MAX_RECEIPT_UPLOAD_BYTES * 4 / 3) + 4)
    expect((await handleParseReceiptRequest(request({
      ...body,
      image: { ...body.image, dataUrl: `data:image/jpeg;base64,${encodedOverLimit}` },
    }), dependencies())).status).toBe(413)

    const giantRequest = request({ ...body, padding: 'x'.repeat(Math.ceil(MAX_RECEIPT_UPLOAD_BYTES * 4 / 3) + 3_000) })
    const giant = await handleParseReceiptRequest(giantRequest, dependencies())
    expect(giant.status).toBe(413)
  })

  it('returns a validated draft and sends strict low-cost provider settings', async () => {
    const fetcher = vi.fn().mockResolvedValue(providerResponse(receiptDraftFixture, 200, 'answering-model'))
    const response = await handleParseReceiptRequest(request(), dependencies({ fetcher }))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ result: receiptDraftFixture, model: 'answering-model' })
    const init = fetcher.mock.calls[0][1] as RequestInit
    const providerBody = JSON.parse(init.body as string)
    expect(providerBody.models).toEqual([...new Set([
      DEFAULT_OPENROUTER_RECEIPT_MODEL,
      DEFAULT_OPENROUTER_RECEIPT_FALLBACK_MODEL,
    ])])
    expect(providerBody.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { name: 'tally_receipt', strict: true },
    })
    expect(providerBody.provider).toMatchObject({ data_collection: 'deny', require_parameters: true, zdr: true })
    expect(init.headers).toMatchObject({ authorization: 'Bearer secret-key' })
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('uses configured models, public URL, and runtime fetch', async () => {
    const runtimeFetch = vi.fn().mockResolvedValue(providerResponse())
    vi.stubGlobal('fetch', runtimeFetch)
    await handleParseReceiptRequest(request(), dependencies({
      fetcher: undefined,
      getEnvironment: name => ({
        AI_RECEIPT_ENABLED: 'true',
        OPENROUTER_API_KEY: 'key',
        OPENROUTER_RECEIPT_MODEL: 'one',
        OPENROUTER_RECEIPT_FALLBACK_MODEL: 'one',
        TALLY_PUBLIC_URL: 'https://preview.example/',
      })[name],
    }))
    const init = runtimeFetch.mock.calls[0][1] as RequestInit
    expect(JSON.parse(init.body as string).models).toEqual(['one'])
    expect(init.headers).toMatchObject({ 'http-referer': 'https://preview.example/' })

    const fallbackFetch = vi.fn().mockResolvedValue(providerResponse())
    await handleParseReceiptRequest(request(), dependencies({
      fetcher: fallbackFetch,
      getEnvironment: name => ({
        AI_RECEIPT_ENABLED: 'true',
        OPENROUTER_API_KEY: 'key',
        OPENROUTER_RECEIPT_MODEL: 'primary',
        OPENROUTER_RECEIPT_FALLBACK_MODEL: 'fallback',
      })[name],
    }))
    expect(JSON.parse(fallbackFetch.mock.calls[0][1].body as string).models).toEqual([
      'primary',
      'fallback',
    ])
  })

  it.each([
    [402, null, 503, 'provider_payment_required'],
    [429, null, 429, 'provider_rate_limit'],
    [408, null, 503, 'model_unavailable'],
    [502, null, 503, 'model_unavailable'],
    [503, null, 503, 'model_unavailable'],
    [504, null, 503, 'model_unavailable'],
    [500, null, 502, 'provider_error'],
    [200, 'payment_required', 503, 'provider_payment_required'],
    [200, 'rate_limit_exceeded', 429, 'provider_rate_limit'],
    [200, 'provider_overloaded', 503, 'model_unavailable'],
    [200, 'something_else', 502, 'provider_error'],
  ])('maps provider failure %s/%s', async (providerStatus, errorType, expectedStatus, code) => {
    const payload = errorType
      ? { error: { code: providerStatus === 200 ? 500 : providerStatus, metadata: { error_type: errorType } } }
      : {}
    const reporter = vi.fn()
    const response = await handleParseReceiptRequest(request(), dependencies({
      fetcher: vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: providerStatus })),
      reportProviderFailure: reporter,
    }))
    expect(response.status).toBe(expectedStatus)
    expect(await response.json()).toMatchObject({ code })
    expect(reporter).toHaveBeenCalledWith(expect.objectContaining({ errorType }))
  })

  it('recognizes embedded choice failures and nonnumeric error codes', async () => {
    const response = await handleParseReceiptRequest(request(), dependencies({
      fetcher: vi.fn().mockResolvedValue(new Response(JSON.stringify({
        choices: [{ error: { code: 'bad', metadata: null } }],
      }))),
    }))
    expect(response.status).toBe(502)

    const nonRecord = await handleParseReceiptRequest(request(), dependencies({
      fetcher: vi.fn().mockImplementation(() => Promise.resolve(new Response('1'))),
    }))
    expect(nonRecord.status).toBe(422)
  })

  it('handles network, missing, oversized, and unreadable provider responses', async () => {
    const networkReporter = vi.fn()
    const network = await handleParseReceiptRequest(request(), dependencies({
      fetcher: vi.fn().mockRejectedValue(new Error('secret')),
      reportProviderFailure: networkReporter,
    }))
    expect(network.status).toBe(503)
    expect(await network.text()).not.toContain('secret')
    expect(networkReporter).toHaveBeenCalledWith(expect.objectContaining({ errorType: 'network' }))

    for (const providerResponseValue of [
      new Response(null),
      new Response('{'),
      new Response(JSON.stringify({ value: 'x'.repeat(256 * 1024) })),
    ]) {
      const response = await handleParseReceiptRequest(request(), dependencies({
        fetcher: vi.fn().mockResolvedValue(providerResponseValue),
      }))
      expect(response.status).toBe(502)
      expect(await response.json()).toMatchObject({ code: 'provider_error' })
    }
  })

  it('retries one unsafe draft with the stronger fallback model', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(providerResponse({ ...receiptDraftFixture, items: [] }, 200, 'primary'))
      .mockResolvedValueOnce(providerResponse(receiptDraftFixture, 200, 'fallback'))
    const reporter = vi.fn()
    const response = await handleParseReceiptRequest(request(), dependencies({
      fetcher,
      getEnvironment: name => ({
        AI_RECEIPT_ENABLED: 'true',
        OPENROUTER_API_KEY: 'key',
        OPENROUTER_RECEIPT_MODEL: 'primary',
        OPENROUTER_RECEIPT_FALLBACK_MODEL: 'fallback',
      })[name],
      reportModelOutputFailure: reporter,
    }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ result: receiptDraftFixture, model: 'fallback' })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetcher.mock.calls[0][1].body as string).models).toEqual(['primary', 'fallback'])
    expect(JSON.parse(fetcher.mock.calls[1][1].body as string).models).toEqual(['fallback'])
    expect(reporter).toHaveBeenCalledWith(expect.objectContaining({
      attempt: 1,
      model: 'primary',
      reason: 'schema_validation',
    }))
  })

  it('returns an actionable error after one bounded unsafe-draft retry', async () => {
    const invalidDraft = { ...receiptDraftFixture, merchant: 'Private Merchant', items: [] }
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(providerResponse(invalidDraft)))
    const reporter = vi.fn()
    const response = await handleParseReceiptRequest(request(), dependencies({
      fetcher,
      reportModelOutputFailure: reporter,
    }))
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({
      code: 'invalid_model_response',
      message: expect.stringContaining('Retake'),
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(reporter).toHaveBeenCalledTimes(2)
    expect(reporter).toHaveBeenLastCalledWith(expect.objectContaining({
      attempt: 2,
      reason: 'schema_validation',
      issues: [expect.objectContaining({ code: 'too_small', path: 'items' })],
    }))
    expect(JSON.stringify(reporter.mock.calls)).not.toContain('Private Merchant')
  })

  it('does not start a validation retry after the provider deadline', async () => {
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(1)
      .mockReturnValue(25_001)
    const fetcher = vi.fn().mockResolvedValue(providerResponse({ ...receiptDraftFixture, items: [] }))
    const response = await handleParseReceiptRequest(request(), dependencies({ fetcher }))
    expect(response.status).toBe(422)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('sanitizes an unexpected local parser failure', async () => {
    const reporter = vi.fn()
    const response = await handleParseReceiptRequest(request(), dependencies({
      fetcher: vi.fn().mockImplementation(() => Promise.resolve(providerResponse())),
      parseProviderOutput: () => { throw new Error('Private parser detail') },
      reportModelOutputFailure: reporter,
    }))
    expect(response.status).toBe(422)
    expect(reporter).toHaveBeenCalledTimes(2)
    expect(reporter).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'schema_validation',
      issues: [],
    }))
    expect(JSON.stringify(reporter.mock.calls)).not.toContain('Private parser detail')
  })
})
