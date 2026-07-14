import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CURRENT_USER } from '../../domain/members'
import type { ActivityGroup, Member } from '../../domain/models'
import { createSharedActivity, type SharedActivity } from '../sharing/shareActivityUrl'
import { createLiveActivityClient, LiveActivityApiError } from './liveActivityApi'

const maya: Member = { id: 'maya', name: 'Maya', initials: 'M', color: '#abc' }
const group: ActivityGroup = { id: 'trip', name: 'Weekend', emoji: '✦', memberIds: ['me', 'maya'] }
const snapshot = createSharedActivity(group, [CURRENT_USER, maya], [])
const credentials = { code: 'A1B2C3D4E5', editToken: 'a'.repeat(64) }
const updatedAt = '2026-07-14T01:00:00.000Z'

function response(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    code: credentials.code,
    edit_token: credentials.editToken,
    revision: 1,
    snapshot,
    updated_at: updatedAt,
    ...overrides,
  }
}

function expectApiError(promise: Promise<unknown>, kind: LiveActivityApiError['kind']) {
  return expect(promise).rejects.toMatchObject({ name: 'LiveActivityApiError', kind })
}

describe('live activity API client', () => {
  const fetcher = vi.fn()

  beforeEach(() => {
    fetcher.mockReset()
  })

  it('creates, loads, and revision-updates a shared backend activity', async () => {
    fetcher
      .mockResolvedValueOnce(response([row()]))
      .mockResolvedValueOnce(response([row({ edit_token: undefined })]))
      .mockResolvedValueOnce(response([row({ edit_token: undefined, revision: 2 })]))
    const client = createLiveActivityClient({ supabaseUrl: ' https://project.supabase.co/// ', publishableKey: ' publishable ' }, fetcher)

    await expect(client.create(snapshot)).resolves.toEqual({ ...credentials, revision: 1, snapshot, updatedAt })
    await expect(client.load(credentials)).resolves.toEqual({ code: credentials.code, revision: 1, snapshot, updatedAt })
    await expect(client.update(credentials, snapshot, 1)).resolves.toEqual({ code: credentials.code, revision: 2, snapshot, updatedAt })

    expect(fetcher).toHaveBeenNthCalledWith(1, 'https://project.supabase.co/rest/v1/rpc/create_shared_activity', expect.objectContaining({
      method: 'POST',
      headers: {
        apikey: 'publishable',
        authorization: 'Bearer publishable',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ p_snapshot: snapshot }),
    }))
    expect(JSON.parse(fetcher.mock.calls[1][1]?.body as string)).toEqual({ p_code: credentials.code, p_edit_token: credentials.editToken })
    expect(JSON.parse(fetcher.mock.calls[2][1]?.body as string)).toMatchObject({ p_expected_revision: 1, p_snapshot: snapshot })
  })

  it.each([
    { supabaseUrl: '', publishableKey: 'key' },
    { supabaseUrl: 'https://project.supabase.co', publishableKey: ' ' },
  ])('requires complete configuration: %j', configuration => {
    expect(() => createLiveActivityClient(configuration, fetcher)).toThrow(expect.objectContaining({ kind: 'configuration' }))
  })

  it('rejects invalid inputs before making a request', async () => {
    const client = createLiveActivityClient({ supabaseUrl: 'https://project.supabase.co', publishableKey: 'key' }, fetcher)
    const invalidSnapshot = { ...snapshot, version: 3 } as unknown as SharedActivity
    const invalidCredentials = { ...credentials, code: 'bad' }

    await expectApiError(client.create(invalidSnapshot), 'invalid-input')
    await expectApiError(client.load(invalidCredentials), 'invalid-input')
    await expectApiError(client.update(credentials, invalidSnapshot, 1), 'invalid-input')
    await expectApiError(client.update(credentials, snapshot, 0), 'invalid-input')
    await expectApiError(client.update(credentials, snapshot, 1.5), 'invalid-input')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each([
    ['40001', 'conflict'],
    ['P0002', 'not-found'],
    ['22023', 'invalid-input'],
    ['XX000', 'backend'],
  ] as const)('maps backend code %s to %s', async (code, kind) => {
    fetcher.mockResolvedValue(response({ code, message: `backend ${code}` }, 400))
    const client = createLiveActivityClient({ supabaseUrl: 'https://project.supabase.co', publishableKey: 'key' }, fetcher)
    await expectApiError(client.load(credentials), kind)
  })

  it('uses a safe fallback for unstructured backend errors', async () => {
    fetcher.mockResolvedValue(response(null, 500))
    const client = createLiveActivityClient({ supabaseUrl: 'https://project.supabase.co', publishableKey: 'key' }, fetcher)
    await expect(client.load(credentials)).rejects.toMatchObject({ kind: 'backend', message: 'Live activity request failed.' })
  })

  it('distinguishes network, unreadable, and unexpected responses', async () => {
    const client = createLiveActivityClient({ supabaseUrl: 'https://project.supabase.co', publishableKey: 'key' }, fetcher)
    fetcher.mockRejectedValueOnce(new Error('offline'))
    await expectApiError(client.load(credentials), 'network')

    fetcher.mockResolvedValueOnce(new Response('not-json'))
    await expectApiError(client.load(credentials), 'invalid-response')

    fetcher.mockResolvedValueOnce(response({ record: row() }))
    await expectApiError(client.load(credentials), 'invalid-response')
    fetcher.mockResolvedValueOnce(response([]))
    await expectApiError(client.load(credentials), 'invalid-response')
    fetcher.mockResolvedValueOnce(response([row(), row()]))
    await expectApiError(client.load(credentials), 'invalid-response')
  })

  it.each([
    null,
    row({ revision: 0 }),
    row({ revision: 1.5 }),
    row({ updated_at: 'not-a-date' }),
    row({ snapshot: {} }),
    row({ code: 'bad' }),
  ])('rejects malformed loaded records: %j', async invalidRow => {
    fetcher.mockResolvedValue(response([invalidRow]))
    const client = createLiveActivityClient({ supabaseUrl: 'https://project.supabase.co', publishableKey: 'key' }, fetcher)
    await expectApiError(client.load(credentials), 'invalid-response')
  })

  it.each([
    row({ edit_token: undefined }),
    row({ edit_token: 'bad' }),
    row({ code: 123 }),
  ])('rejects malformed create credentials: %j', async invalidRow => {
    fetcher.mockResolvedValue(response([invalidRow]))
    const client = createLiveActivityClient({ supabaseUrl: 'https://project.supabase.co', publishableKey: 'key' }, fetcher)
    await expectApiError(client.create(snapshot), 'invalid-response')
  })
})
