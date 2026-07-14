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

export type CreatedLiveActivity = LiveActivityRecord & LiveActivityCredentials

export type LiveActivityApiErrorKind =
  | 'configuration'
  | 'invalid-input'
  | 'not-found'
  | 'conflict'
  | 'backend'
  | 'network'
  | 'invalid-response'

export class LiveActivityApiError extends Error {
  constructor(public readonly kind: LiveActivityApiErrorKind, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'LiveActivityApiError'
  }
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
type ApiConfiguration = { supabaseUrl: string; publishableKey: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function responseErrorKind(body: unknown): LiveActivityApiErrorKind {
  const code = isRecord(body) && typeof body.code === 'string' ? body.code : ''
  if (code === '40001') return 'conflict'
  if (code === 'P0002') return 'not-found'
  if (code === '22023') return 'invalid-input'
  return 'backend'
}

function parseRecord(value: unknown, requireToken: boolean): CreatedLiveActivity | LiveActivityRecord {
  if (!isRecord(value)
    || !Number.isInteger(value.revision)
    || (value.revision as number) < 1
    || typeof value.updated_at !== 'string'
    || Number.isNaN(Date.parse(value.updated_at))
    || !isSharedActivity(value.snapshot)) {
    throw new LiveActivityApiError('invalid-response', 'The live activity service returned an invalid record.')
  }

  const credentials = { code: value.code, editToken: value.edit_token }
  if (requireToken ? !isLiveActivityCredentials(credentials) : typeof value.code !== 'string' || !isLiveActivityCredentials({ code: value.code, editToken: '0'.repeat(64) })) {
    throw new LiveActivityApiError('invalid-response', 'The live activity service returned invalid credentials.')
  }

  const record: LiveActivityRecord = {
    code: value.code as string,
    revision: value.revision as number,
    snapshot: value.snapshot,
    updatedAt: value.updated_at,
  }
  return requireToken ? { ...record, editToken: value.edit_token as string } : record
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
  if (!supabaseUrl || !publishableKey) {
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
      throw new LiveActivityApiError(responseErrorKind(payload), isRecord(payload) && typeof payload.message === 'string' ? payload.message : 'Live activity request failed.')
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
    async update(credentials: LiveActivityCredentials, snapshot: SharedActivity, expectedRevision: number): Promise<LiveActivityRecord> {
      assertCredentials(credentials)
      assertSnapshot(snapshot)
      if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
        throw new LiveActivityApiError('invalid-input', 'A positive expected revision is required.')
      }
      return parseRecord(await rpc('update_shared_activity', {
        p_code: credentials.code,
        p_edit_token: credentials.editToken,
        p_expected_revision: expectedRevision,
        p_snapshot: snapshot,
      }), false)
    },
  }
}
