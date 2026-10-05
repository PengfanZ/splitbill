import { z } from 'zod'
import { LIVE_ACTIVITY_CODE_PATTERN, LIVE_ACTIVITY_TOKEN_PATTERN } from '../liveSharing/liveActivityLink'

/**
 * The hand-off between an agent's local tally-splitbill-mcp process and Tally in the browser.
 * tally-splitbill-mcp opens `#agent-link=<port>.<state>.<client>`; after the person approves,
 * Tally navigates to `http://127.0.0.1:<port>/done#<payload>`. Fragments never reach a server.
 */
export const AGENT_LINK_HASH_PREFIX = '#agent-link='
export const AGENT_LINK_MAX_ACTIVITIES = 20
export const AGENT_CLIENTS = ['claude-code', 'codex', 'other'] as const

export type AgentClient = typeof AGENT_CLIENTS[number]
export type AgentLinkRequest = { port: number; state: string; client: AgentClient }

const STATE_PATTERN = /^[a-f0-9]{32}$/

const payloadSchema = z.object({
  state: z.string().regex(STATE_PATTERN),
  activities: z.array(z.object({
    code: z.string().regex(LIVE_ACTIVITY_CODE_PATTERN),
    editToken: z.string().regex(LIVE_ACTIVITY_TOKEN_PATTERN),
    memberId: z.string().min(1).max(120),
  }).strict()).min(1).max(AGENT_LINK_MAX_ACTIVITIES),
}).strict()

export type AgentLinkPayload = z.infer<typeof payloadSchema>

export function agentClientFromName(name: string | undefined): AgentClient {
  const normalized = name?.toLowerCase() ?? ''
  if (normalized.includes('claude')) return 'claude-code'
  if (normalized.includes('codex')) return 'codex'
  return 'other'
}

export function buildAgentLinkHash(request: AgentLinkRequest) {
  return `${AGENT_LINK_HASH_PREFIX}${request.port}.${request.state}.${request.client}`
}

export function parseAgentLinkHash(hash: string): AgentLinkRequest | null {
  if (!hash.startsWith(AGENT_LINK_HASH_PREFIX)) return null
  const [portText, state, client, extra] = hash.slice(AGENT_LINK_HASH_PREFIX.length).split('.')
  const port = Number(portText)
  if (extra !== undefined
    || !/^\d{4,5}$/.test(portText)
    || port < 1024 || port > 65_535
    || !STATE_PATTERN.test(state ?? '')
    || !(AGENT_CLIENTS as readonly string[]).includes(client ?? '')) return null
  return { port, state, client: client as AgentClient }
}

function toBase64Url(text: string) {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(encoded: string) {
  const binary = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'))
  return new TextDecoder().decode(Uint8Array.from(binary, character => character.charCodeAt(0)))
}

export function agentLinkCallbackUrl(request: AgentLinkRequest, payload: AgentLinkPayload) {
  return `http://127.0.0.1:${request.port}/done#${toBase64Url(JSON.stringify(payloadSchema.parse(payload)))}`
}

export function decodeAgentLinkPayload(encoded: string): AgentLinkPayload | null {
  try {
    const parsed = payloadSchema.safeParse(JSON.parse(fromBase64Url(encoded)))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
