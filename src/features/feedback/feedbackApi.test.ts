import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createConfiguredFeedbackClient,
  createFeedbackClient,
  FeedbackApiError,
  parseFeedbackSubmission,
  type FeedbackSubmission,
} from './feedbackApi'

const submission: FeedbackSubmission = {
  category: 'idea',
  message: 'Make the balance easier to scan.',
  locale: 'en',
  rating: null,
  surface: 'local',
  release: '2026-08-live-controls',
}

function response(result: unknown, status = 200) {
  return new Response(JSON.stringify(result), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

async function expectErrorKind(promise: Promise<unknown>, kind: FeedbackApiError['kind']) {
  await expect(promise).rejects.toMatchObject({ name: 'FeedbackApiError', kind })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('feedback submission contract', () => {
  it('trims a valid, privacy-safe submission', () => {
    expect(parseFeedbackSubmission({ ...submission, message: '  Clearer totals please.  ' })).toEqual({
      ...submission,
      message: 'Clearer totals please.',
    })
  })

  it('accepts a rating without a written note', () => {
    expect(parseFeedbackSubmission({ ...submission, message: '   ', rating: 5 })).toEqual({
      ...submission,
      message: '',
      rating: 5,
    })
  })

  it.each([
    { ...submission, category: 'question' },
    { ...submission, message: '  x  ' },
    { ...submission, message: '', rating: null },
    { ...submission, rating: 0 },
    { ...submission, rating: 6 },
    { ...submission, message: 'x'.repeat(1001) },
    { ...submission, locale: 'en-US' },
    { ...submission, surface: 'snapshot' },
    { ...submission, release: '' },
    { ...submission, release: `r${'x'.repeat(64)}` },
    { ...submission, release: 'release with spaces' },
    { ...submission, activityName: 'Private trip' },
  ])('rejects data outside the narrow contract: %j', invalid => {
    expect(() => parseFeedbackSubmission(invalid)).toThrow()
  })
})

describe('feedback API client', () => {
  it.each([
    ['https://project.supabase.co', undefined],
    ['http://localhost:54321', 5_000],
    ['http://127.0.0.1:54321', 5_000],
    ['http://[::1]:54321', 5_000],
  ] as const)('accepts secure and loopback Supabase URLs: %s', async (url, requestTimeoutMs) => {
    const fetcher = vi.fn().mockResolvedValue(response('submitted'))
    const client = createFeedbackClient({
      supabaseUrl: ` ${url}/ `,
      publishableKey: ' key ',
      requestTimeoutMs,
    }, fetcher)

    await expect(client.submit(submission)).resolves.toBeUndefined()
  })

  it.each([
    { supabaseUrl: '', publishableKey: 'key' },
    { supabaseUrl: 'not a URL', publishableKey: 'key' },
    { supabaseUrl: 'http://example.com', publishableKey: 'key' },
    { supabaseUrl: 'https://project.supabase.co', publishableKey: '' },
    { supabaseUrl: 'https://project.supabase.co', publishableKey: 'key', requestTimeoutMs: 0 },
    { supabaseUrl: 'https://project.supabase.co', publishableKey: 'key', requestTimeoutMs: 1.5 },
  ])('rejects unsafe or incomplete configuration: %j', configuration => {
    expect(() => createFeedbackClient(configuration)).toThrow(expect.objectContaining({ kind: 'configuration' }))
  })

  it('posts only the allowlisted feedback fields', async () => {
    const fetcher = vi.fn().mockResolvedValue(response('submitted'))
    const client = createFeedbackClient({
      supabaseUrl: ' https://project.supabase.co/ ',
      publishableKey: ' publishable-key ',
    }, fetcher)

    await client.submit({ ...submission, message: '  Better mobile spacing.  ', surface: 'live' })

    expect(fetcher).toHaveBeenCalledWith(
      'https://project.supabase.co/rest/v1/rpc/submit_feedback',
      expect.objectContaining({
        method: 'POST',
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        headers: {
          apikey: 'publishable-key',
          authorization: 'Bearer publishable-key',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          p_category: 'idea',
          p_message: 'Better mobile spacing.',
          p_locale: 'en',
          p_rating: null,
          p_surface: 'live',
          p_release: '2026-08-live-controls',
        }),
      }),
    )
    expect(JSON.stringify(fetcher.mock.calls[0])).not.toContain('activityName')
  })

  it('uses browser fetch by default', async () => {
    const fetcher = vi.fn().mockResolvedValue(response('submitted'))
    vi.stubGlobal('fetch', fetcher)
    const client = createFeedbackClient({
      supabaseUrl: 'https://project.supabase.co',
      publishableKey: 'key',
    })

    await client.submit(submission)
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('rejects invalid client input before making a request', async () => {
    const fetcher = vi.fn()
    const client = createFeedbackClient({
      supabaseUrl: 'https://project.supabase.co',
      publishableKey: 'key',
    }, fetcher)

    await expectErrorKind(client.submit({ ...submission, message: 'x' }), 'invalid-input')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('maps network and unreadable responses', async () => {
    const networkClient = createFeedbackClient({
      supabaseUrl: 'https://project.supabase.co',
      publishableKey: 'key',
    }, vi.fn().mockRejectedValue(new Error('offline')))
    await expectErrorKind(networkClient.submit(submission), 'network')

    const unreadableClient = createFeedbackClient({
      supabaseUrl: 'https://project.supabase.co',
      publishableKey: 'key',
    }, vi.fn().mockResolvedValue(new Response('not json')))
    await expectErrorKind(unreadableClient.submit(submission), 'invalid-response')
  })

  it.each([
    ['rate_limit', 200, 'rate-limit'],
    ['unexpected', 429, 'rate-limit'],
    ['invalid_request', 200, 'invalid-input'],
    ['unexpected', 400, 'invalid-input'],
    [{ error: 'down' }, 503, 'unavailable'],
    [{ status: 'unknown' }, 200, 'invalid-response'],
  ] as const)('maps service result %j with status %s', async (result, status, kind) => {
    const client = createFeedbackClient({
      supabaseUrl: 'https://project.supabase.co',
      publishableKey: 'key',
    }, vi.fn().mockResolvedValue(response(result, status)))

    await expectErrorKind(client.submit(submission), kind)
  })
})

describe('configured feedback client', () => {
  it.each([
    {},
    { VITE_SUPABASE_URL: 'https://project.supabase.co' },
    { VITE_SUPABASE_PUBLISHABLE_KEY: 'key' },
    { VITE_SUPABASE_URL: 'not a URL', VITE_SUPABASE_PUBLISHABLE_KEY: 'key' },
  ])('disables feedback for incomplete or unsafe configuration: %j', environment => {
    expect(createConfiguredFeedbackClient(environment)).toBeNull()
  })

  it('creates the feedback client from trimmed environment values', () => {
    expect(createConfiguredFeedbackClient({
      VITE_SUPABASE_URL: ' https://project.supabase.co/ ',
      VITE_SUPABASE_PUBLISHABLE_KEY: ' key ',
    })).not.toBeNull()
  })
})
