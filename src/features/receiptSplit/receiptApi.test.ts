import { describe, expect, it, vi } from 'vitest'
import { receiptDraftFixture } from './receiptContract.test'
import {
  createConfiguredReceiptClient,
  createReceiptClient,
  ReceiptApiError,
} from './receiptApi'

const request = {
  image: { dataUrl: 'data:image/jpeg;base64,QQ==', width: 1, height: 1 },
  locale: 'en' as const,
  currency: 'USD' as const,
}

function response(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status })
}

describe('receipt API client', () => {
  it('records model validation failures separately from bad photo input', async () => {
    const reportDiagnostic = vi.fn()
    const client = createReceiptClient({ supabaseUrl: 'https://example.com', publishableKey: 'key', reportDiagnostic },
      vi.fn().mockResolvedValue(response({ code: 'invalid_model_response' }, 422)))
    await expect(client.parse(request)).rejects.toMatchObject({ kind: 'invalid-response' })
    expect(reportDiagnostic).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'invalid-response', status: 422 }))
  })
  it('distinguishes browser timeouts from network errors and correlates the server request', async () => {
    const reportDiagnostic = vi.fn()
    const fetcher = vi.fn((_url, options) => new Promise<Response>((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(options.signal.reason), { once: true })
    }))
    const client = createReceiptClient({ supabaseUrl: 'https://example.com', publishableKey: 'key', requestTimeoutMs: 5, reportDiagnostic }, fetcher)
    await expect(client.parse(request)).rejects.toMatchObject({ kind: 'network' })
    expect(reportDiagnostic).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ outcome: 'timeout', status: null }))
    expect(reportDiagnostic.mock.calls[0][0].requestId).toBe(fetcher.mock.calls[0][1]?.headers['x-tally-request-id'])
  })

  it('reports successful and rejected outcomes without changing parsing when logging fails', async () => {
    const reportDiagnostic = vi.fn(() => { throw new Error('logger unavailable') })
    const client = createReceiptClient({ supabaseUrl: 'https://example.com', publishableKey: 'key', reportDiagnostic }, vi.fn().mockResolvedValue(response({ result: receiptDraftFixture })))
    await expect(client.parse(request)).resolves.toEqual(receiptDraftFixture)
    expect(reportDiagnostic).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'success', status: 200 }))
    const rejected = createReceiptClient({ supabaseUrl: 'https://example.com', publishableKey: 'key', reportDiagnostic }, vi.fn().mockResolvedValue(response({ code: 'rate_limit_exceeded' }, 429)))
    await expect(rejected.parse(request)).rejects.toMatchObject({ kind: 'rate-limit' })
    expect(reportDiagnostic).toHaveBeenLastCalledWith(expect.objectContaining({ outcome: 'rate-limit', status: 429 }))
  })

  it('reports unexpected client exceptions without leaking exception text', async () => {
    const reportDiagnostic = vi.fn()
    const malformedResponse = Object.defineProperty(new Response(), 'status', { get() { throw new Error('private error') } })
    const client = createReceiptClient({ supabaseUrl: 'https://example.com', publishableKey: 'key', reportDiagnostic }, vi.fn().mockResolvedValue(malformedResponse))
    await expect(client.parse(request)).rejects.toThrow('private error')
    expect(reportDiagnostic).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'unavailable' }))
    expect(JSON.stringify(reportDiagnostic.mock.calls)).not.toContain('private error')
  })
  it('validates configuration and supports secure local development URLs', () => {
    expect(() => createReceiptClient({ supabaseUrl: 'bad', publishableKey: 'key' })).toThrow(ReceiptApiError)
    expect(() => createReceiptClient({ supabaseUrl: 'http://example.com', publishableKey: 'key' })).toThrow('required')
    expect(() => createReceiptClient({ supabaseUrl: 'https://example.com', publishableKey: '' })).toThrow('required')
    expect(() => createReceiptClient({
      supabaseUrl: 'https://example.com',
      publishableKey: 'key',
      functionName: '../parse-receipt',
    })).toThrow('required')
    expect(() => createReceiptClient({ supabaseUrl: 'http://localhost:54321', publishableKey: 'key', requestTimeoutMs: 0 })).toThrow('required')
    expect(createReceiptClient({ supabaseUrl: 'http://127.0.0.1:54321/', publishableKey: 'key' })).toBeTruthy()
    expect(createReceiptClient({ supabaseUrl: 'http://[::1]:54321', publishableKey: 'key' })).toBeTruthy()
  })

  it('posts a validated image and parses the draft', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ result: receiptDraftFixture }))
    const client = createReceiptClient({ supabaseUrl: 'https://project.supabase.co/', publishableKey: 'key' }, fetcher)
    await expect(client.parse(request)).resolves.toEqual(receiptDraftFixture)
    expect(fetcher).toHaveBeenCalledWith('https://project.supabase.co/functions/v1/parse-receipt', expect.objectContaining({
      method: 'POST',
      credentials: 'omit',
      headers: expect.objectContaining({ apikey: 'key', 'x-tally-input-mode': 'receipt' }),
    }))
  })

  it('can target an isolated preview function without changing the production default', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ result: receiptDraftFixture }))
    const client = createReceiptClient({
      supabaseUrl: 'https://project.supabase.co',
      publishableKey: 'key',
      functionName: 'parse-receipt-preview',
    }, fetcher)
    await client.parse(request)
    expect(fetcher).toHaveBeenCalledWith(
      'https://project.supabase.co/functions/v1/parse-receipt-preview',
      expect.any(Object),
    )
  })

  it('classifies input, network, provider, and malformed response failures', async () => {
    const cases: Array<[number, unknown, string]> = [
      [400, { message: 'bad photo' }, 'invalid-input'],
      [429, { code: 'rate_limit_exceeded' }, 'rate-limit'],
      [503, { code: 'provider_payment_required' }, 'credits'],
      [503, { code: 'ai_budget_exceeded' }, 'credits'],
      [503, { code: 'model_unavailable' }, 'model-unavailable'],
      [503, { code: 'provider_unavailable' }, 'model-unavailable'],
      [429, { code: 'provider_rate_limit' }, 'model-unavailable'],
      [429, {}, 'rate-limit'],
      [500, {}, 'unavailable'],
    ]
    for (const [status, payload, kind] of cases) {
      const client = createReceiptClient({ supabaseUrl: 'https://project.supabase.co', publishableKey: 'key' }, vi.fn().mockResolvedValue(response(payload, status)))
      await expect(client.parse(request)).rejects.toMatchObject({ kind })
    }

    const invalid = createReceiptClient({ supabaseUrl: 'https://project.supabase.co', publishableKey: 'key' })
    await expect(invalid.parse({ ...request, locale: 'bad' as 'en' })).rejects.toMatchObject({ kind: 'invalid-input' })
    const offline = createReceiptClient({ supabaseUrl: 'https://project.supabase.co', publishableKey: 'key' }, vi.fn().mockRejectedValue(new Error('offline')))
    await expect(offline.parse(request)).rejects.toMatchObject({ kind: 'network' })
    const unreadable = createReceiptClient({ supabaseUrl: 'https://project.supabase.co', publishableKey: 'key' }, vi.fn().mockResolvedValue(new Response('{')))
    await expect(unreadable.parse(request)).rejects.toMatchObject({ kind: 'invalid-response' })
    const tooLarge = createReceiptClient({ supabaseUrl: 'https://project.supabase.co', publishableKey: 'key' }, vi.fn().mockResolvedValue(new Response('x'.repeat(512 * 1024 + 1))))
    await expect(tooLarge.parse(request)).rejects.toMatchObject({ kind: 'invalid-response' })
    const missing = createReceiptClient({ supabaseUrl: 'https://project.supabase.co', publishableKey: 'key' }, vi.fn().mockResolvedValue(response({})))
    await expect(missing.parse(request)).rejects.toMatchObject({ kind: 'invalid-response' })
    const badDraft = createReceiptClient({ supabaseUrl: 'https://project.supabase.co', publishableKey: 'key' }, vi.fn().mockResolvedValue(response({ result: {} })))
    await expect(badDraft.parse(request)).rejects.toMatchObject({ kind: 'invalid-response' })
  })

  it('uses fallback server messages and configures only an explicitly enabled client', async () => {
    const client = createReceiptClient({ supabaseUrl: 'https://project.supabase.co', publishableKey: 'key' }, vi.fn().mockResolvedValue(response(null, 503)))
    await expect(client.parse(request)).rejects.toThrow('temporarily unavailable')

    expect(createConfiguredReceiptClient({})).toBeNull()
    expect(createConfiguredReceiptClient({ VITE_RECEIPT_SPLIT_ENABLED: 'false' })).toBeNull()
    expect(createConfiguredReceiptClient({ VITE_RECEIPT_SPLIT_ENABLED: 'true' })).toBeNull()
    expect(createConfiguredReceiptClient({
      VITE_RECEIPT_SPLIT_ENABLED: 'true',
      VITE_SUPABASE_URL: 'bad',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'key',
    })).toBeNull()
    expect(createConfiguredReceiptClient({
      VITE_RECEIPT_SPLIT_ENABLED: 'true',
      VITE_SUPABASE_URL: 'https://project.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'key',
    })).toBeTruthy()
    expect(createConfiguredReceiptClient({
      VITE_RECEIPT_SPLIT_ENABLED: 'true',
      VITE_RECEIPT_FUNCTION_NAME: 'bad/path',
      VITE_SUPABASE_URL: 'https://project.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'key',
    })).toBeNull()
  })
})
