import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiExpenseRequest } from './aiExpenseContract'
import {
  AiExpenseApiError,
  createAiExpenseClient,
  createConfiguredAiExpenseClient,
} from './aiExpenseApi'

const request: AiExpenseRequest = {
  text: 'Maya paid $20 for lunch',
  locale: 'en',
  currency: 'USD',
  members: [{ id: 'maya', name: 'Maya' }],
}

const readyResult = {
  status: 'ready',
  title: 'Lunch',
  amountCents: 2000,
  payerId: 'maya',
  splitMethod: 'equal',
  participantIds: ['maya'],
  exactSharesCents: [],
} as const

function response(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status })
}

function expectApiError(promise: Promise<unknown>, kind: AiExpenseApiError['kind']) {
  return expect(promise).rejects.toMatchObject({ name: 'AiExpenseApiError', kind })
}

describe('AI expense API client', () => {
  const fetcher = vi.fn()

  beforeEach(() => {
    fetcher.mockReset()
  })

  it('calls the protected Edge Function and parses ready and clarification results', async () => {
    fetcher
      .mockResolvedValueOnce(response({ result: readyResult, model: 'free-model' }))
      .mockResolvedValueOnce(response({ result: { status: 'needs_clarification', question: 'Who paid?' } }))
    const client = createAiExpenseClient({
      supabaseUrl: ' https://preview.supabase.co/// ',
      publishableKey: ' publishable-key ',
    }, fetcher)

    await expect(client.parse(request)).resolves.toEqual(readyResult)
    await expect(client.parse(request)).resolves.toEqual({ status: 'needs_clarification', question: 'Who paid?' })
    expect(fetcher).toHaveBeenNthCalledWith(1, 'https://preview.supabase.co/functions/v1/parse-expense', expect.objectContaining({
      method: 'POST',
      headers: {
        apikey: 'publishable-key',
        'content-type': 'application/json',
      },
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: expect.any(AbortSignal),
      body: JSON.stringify(request),
    }))
  })

  it.each([
    { supabaseUrl: '', publishableKey: 'key' },
    { supabaseUrl: 'not-a-url', publishableKey: 'key' },
    { supabaseUrl: 'https://project.supabase.co', publishableKey: '' },
    { supabaseUrl: 'http://example.com', publishableKey: 'key' },
    { supabaseUrl: 'https://project.supabase.co', publishableKey: 'key', requestTimeoutMs: 0 },
    { supabaseUrl: 'https://project.supabase.co', publishableKey: 'key', requestTimeoutMs: 1.5 },
  ])('rejects invalid configuration: %j', configuration => {
    expect(() => createAiExpenseClient(configuration, fetcher)).toThrow(expect.objectContaining({ kind: 'configuration' }))
  })

  it('allows local HTTP development URLs and a custom timeout', () => {
    expect(createAiExpenseClient({ supabaseUrl: 'http://localhost:54321', publishableKey: 'key', requestTimeoutMs: 50 }, fetcher)).toMatchObject({ parse: expect.any(Function) })
    expect(createAiExpenseClient({ supabaseUrl: 'http://127.0.0.1:54321', publishableKey: 'key' }, fetcher)).toMatchObject({ parse: expect.any(Function) })
    expect(createAiExpenseClient({ supabaseUrl: 'http://[::1]:54321', publishableKey: 'key' }, fetcher)).toMatchObject({ parse: expect.any(Function) })
  })

  it('rejects invalid input before making a request', async () => {
    const client = createAiExpenseClient({ supabaseUrl: 'https://project.supabase.co', publishableKey: 'key' }, fetcher)
    await expectApiError(client.parse({ ...request, members: [] }), 'invalid-input')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each([
    [400, 'invalid-input'],
    [413, 'invalid-input'],
    [422, 'invalid-input'],
    [429, 'rate-limit'],
    [500, 'unavailable'],
  ] as const)('maps HTTP %s to %s', async (status, kind) => {
    fetcher.mockResolvedValue(response({ message: 'Safe backend message' }, status))
    const client = createAiExpenseClient({ supabaseUrl: 'https://project.supabase.co', publishableKey: 'key' }, fetcher)
    await expect(client.parse(request)).rejects.toMatchObject({ kind, message: 'Safe backend message' })
  })

  it('maps a legacy invalid model response to actionable invalid input', async () => {
    fetcher.mockResolvedValue(response({
      code: 'invalid_model_response',
      message: 'The AI response could not be safely converted into an expense.',
    }, 502))
    const client = createAiExpenseClient({ supabaseUrl: 'https://project.supabase.co', publishableKey: 'key' }, fetcher)
    await expect(client.parse(request)).rejects.toMatchObject({ kind: 'invalid-input' })
  })

  it.each([
    ['model_unavailable', 'model-unavailable'],
    ['provider_error', 'model-unavailable'],
    ['provider_unavailable', 'model-unavailable'],
    ['provider_payment_required', 'credits'],
  ] as const)('maps backend code %s to %s', async (code, kind) => {
    fetcher.mockResolvedValue(response({ code, message: 'Safe backend message' }, 503))
    const client = createAiExpenseClient({ supabaseUrl: 'https://project.supabase.co', publishableKey: 'key' }, fetcher)
    await expect(client.parse(request)).rejects.toMatchObject({ kind })
  })

  it('uses a safe fallback for an unstructured backend error', async () => {
    fetcher.mockResolvedValue(response(null, 500))
    const client = createAiExpenseClient({ supabaseUrl: 'https://project.supabase.co', publishableKey: 'key' }, fetcher)
    await expect(client.parse(request)).rejects.toMatchObject({
      kind: 'unavailable',
      message: 'AI expense entry is temporarily unavailable.',
    })
  })

  it('distinguishes network, unreadable, missing, and invalid results', async () => {
    const client = createAiExpenseClient({ supabaseUrl: 'https://project.supabase.co', publishableKey: 'key' }, fetcher)
    fetcher.mockRejectedValueOnce(new Error('offline'))
    await expectApiError(client.parse(request), 'network')

    fetcher.mockResolvedValueOnce(new Response('{'))
    await expectApiError(client.parse(request), 'invalid-response')

    fetcher.mockResolvedValueOnce(response({ model: 'free' }))
    await expectApiError(client.parse(request), 'invalid-response')

    fetcher.mockResolvedValueOnce(response({ result: { status: 'ready' } }))
    await expectApiError(client.parse(request), 'invalid-response')
  })

  it('enables only explicitly configured preview builds', () => {
    expect(createConfiguredAiExpenseClient({})).toBeNull()
    expect(createConfiguredAiExpenseClient({ VITE_AI_EXPENSE_ENABLED: 'false' })).toBeNull()
    expect(createConfiguredAiExpenseClient({ VITE_AI_EXPENSE_ENABLED: 'true' })).toBeNull()
    expect(createConfiguredAiExpenseClient({
      VITE_AI_EXPENSE_ENABLED: 'true',
      VITE_SUPABASE_URL: 'not-a-url',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'key',
    })).toBeNull()
    expect(createConfiguredAiExpenseClient({
      VITE_AI_EXPENSE_ENABLED: 'true',
      VITE_SUPABASE_URL: 'https://preview.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'key',
    })).toMatchObject({ parse: expect.any(Function) })
  })
})
