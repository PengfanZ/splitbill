import { isSharedActivity, type SharedActivity } from '../sharing/shareActivityUrl'
import {
  isLiveActivityCredentials,
  type LiveActivityCredentials,
} from './liveActivityLink'

export type LiveActivityRecord = {
  code: string
  revision: number
  snapshot: SharedActivity
  updatedAt: string
}

export type LiveActivityRevision = Omit<LiveActivityRecord, 'snapshot'>

export type CreatedLiveActivity = LiveActivityRecord & LiveActivityCredentials

export type LiveActivityApiErrorKind =
  | 'configuration'
  | 'invalid-input'
  | 'not-found'
  | 'conflict'
  | 'rate-limit'
  | 'backend'
  | 'network'
  | 'invalid-response'

type LiveActivityApiErrorOptions = ErrorOptions & { latestRecord?: LiveActivityRecord }

export class LiveActivityApiError extends Error {
  public readonly latestRecord?: LiveActivityRecord

  constructor(public readonly kind: LiveActivityApiErrorKind, message: string, options?: LiveActivityApiErrorOptions) {
    super(message, options)
    this.name = 'LiveActivityApiError'
    this.latestRecord = options?.latestRecord
  }
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
type ApiConfiguration = { supabaseUrl: string; publishableKey: string; requestTimeoutMs?: number }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function responseErrorKind(body: unknown, status: number): LiveActivityApiErrorKind {
  if (status === 429) return 'rate-limit'
  if (status === 409) return 'conflict'
  const code = isRecord(body) && typeof body.code === 'string' ? body.code : ''
  if (code === '40001') return 'conflict'
  if (code === 'P0002') return 'not-found'
  if (code === '22023') return 'invalid-input'
  return 'backend'
}

function parseRevision(value: unknown): LiveActivityRevision {
  if (!isRecord(value)
    || !Number.isInteger(value.revision)
    || (value.revision as number) < 1
    || typeof value.updated_at !== 'string'
    || Number.isNaN(Date.parse(value.updated_at))) {
    throw new LiveActivityApiError('invalid-response', 'The live activity service returned an invalid record.')
  }

  if (typeof value.code !== 'string' || !isLiveActivityCredentials({ code: value.code, editToken: '0'.repeat(64) })) {
    throw new LiveActivityApiError('invalid-response', 'The live activity service returned invalid credentials.')
  }

  return {
    code: value.code,
    revision: value.revision as number,
    updatedAt: value.updated_at,
  }
}

function parseRecord(value: unknown, requireToken: boolean): CreatedLiveActivity | LiveActivityRecord {
  const revision = parseRevision(value)
  const row = value as Record<string, unknown>
  if (!isSharedActivity(row.snapshot)) {
    throw new LiveActivityApiError('invalid-response', 'The live activity service returned an invalid record.')
  }

  const credentials = { code: row.code, editToken: row.edit_token }
  if (requireToken && !isLiveActivityCredentials(credentials)) {
    throw new LiveActivityApiError('invalid-response', 'The live activity service returned invalid credentials.')
  }

  const record: LiveActivityRecord = { ...revision, snapshot: row.snapshot }
  return requireToken ? { ...record, editToken: row.edit_token as string } : record
}

function assertSnapshot(snapshot: SharedActivity) {
  if (!isSharedActivity(snapshot)) throw new LiveActivityApiError('invalid-input', 'A valid activity snapshot is required.')
}

function assertCredentials(credentials: LiveActivityCredentials) {
  if (!isLiveActivityCredentials(credentials)) throw new LiveActivityApiError('invalid-input', 'A valid activity code and edit token are required.')
}

export function createLiveActivityClient(configuration: ApiConfiguration, fetcher: Fetcher = fetch) {
  const supabaseUrl = configuration.supabaseUrl.trim().replace(/\/+$/, '')
  const publishableKey = configuration.publishableKey.trim()
  const requestTimeoutMs = configuration.requestTimeoutMs ?? 15_000
  let parsedUrl: URL
  try {
    parsedUrl = new URL(supabaseUrl)
  } catch {
    throw new LiveActivityApiError('configuration', 'A valid Supabase URL is required.')
  }
  const localDevelopmentUrl = parsedUrl.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsedUrl.hostname)
  if (!supabaseUrl
    || !publishableKey
    || (parsedUrl.protocol !== 'https:' && !localDevelopmentUrl)
    || !Number.isInteger(requestTimeoutMs)
    || requestTimeoutMs < 1) {
    throw new LiveActivityApiError('configuration', 'Supabase URL and publishable key are required.')
  }

  const rpc = async (functionName: string, body: Record<string, unknown>) => {
    let response: Response
    try {
      response = await fetcher(`${supabaseUrl}/rest/v1/rpc/${functionName}`, {
        method: 'POST',
        headers: {
          apikey: publishableKey,
          authorization: `Bearer ${publishableKey}`,
          'content-type': 'application/json',
        },
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal: AbortSignal.timeout(requestTimeoutMs),
        body: JSON.stringify(body),
      })
    } catch (cause) {
      throw new LiveActivityApiError('network', 'Could not reach the live activity service.', { cause })
    }

    let payload: unknown
    try {
      payload = await response.json()
    } catch (cause) {
      throw new LiveActivityApiError('invalid-response', 'The live activity service returned unreadable data.', { cause })
    }
    if (!response.ok) {
      throw new LiveActivityApiError(responseErrorKind(payload, response.status), isRecord(payload) && typeof payload.message === 'string' ? payload.message : 'Live activity request failed.')
    }
    if (!Array.isArray(payload) || payload.length !== 1) {
      throw new LiveActivityApiError('invalid-response', 'The live activity service returned an unexpected result.')
    }
    return payload[0]
  }

  return {
    async create(snapshot: SharedActivity): Promise<CreatedLiveActivity> {
      assertSnapshot(snapshot)
      return parseRecord(await rpc('create_shared_activity', { p_snapshot: snapshot }), true) as CreatedLiveActivity
    },
    async load(credentials: LiveActivityCredentials): Promise<LiveActivityRecord> {
      assertCredentials(credentials)
      return parseRecord(await rpc('load_shared_activity', {
        p_code: credentials.code,
        p_edit_token: credentials.editToken,
      }), false)
    },
    async poll(credentials: LiveActivityCredentials): Promise<LiveActivityRevision> {
      assertCredentials(credentials)
      return parseRevision(await rpc('poll_shared_activity', {
        p_code: credentials.code,
        p_edit_token: credentials.editToken,
      }))
    },
    async update(credentials: LiveActivityCredentials, snapshot: SharedActivity, expectedRevision: number): Promise<LiveActivityRecord> {
      assertCredentials(credentials)
      assertSnapshot(snapshot)
      if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
        throw new LiveActivityApiError('invalid-input', 'A positive expected revision is required.')
      }
      const result = await rpc('update_shared_activity_v2', {
        p_code: credentials.code,
        p_edit_token: credentials.editToken,
        p_expected_revision: expectedRevision,
        p_snapshot: snapshot,
      })
      if (!isRecord(result) || typeof result.conflicted !== 'boolean') {
        throw new LiveActivityApiError('invalid-response', 'The live activity service returned an invalid update result.')
      }
      const record = parseRecord(result, false) as LiveActivityRecord
      if (result.conflicted) {
        throw new LiveActivityApiError('conflict', 'A newer activity revision is available.', { latestRecord: record })
      }
      return record
    },
  }
}
