import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  buildAgentLinkHash,
  decodeAgentLinkPayload,
  type AgentClient,
  type AgentLinkPayload,
} from './agentLinkProtocol'

export const AGENT_LINK_TIMEOUT_MS = 5 * 60_000
const MAX_BODY_BYTES = 64 * 1024

export type AgentLinkSession = {
  approvalUrl: string
  /** Resolves with the approved activities, or rejects after the timeout or `close()`. */
  approval: Promise<AgentLinkPayload>
  close(): void
}

type SessionOptions = {
  appUrl: string
  client: AgentClient
  timeoutMs?: number
  createState?: () => string
}

function page(title: string, body: string, script = '', nonce = '') {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>`
    + '<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f7f4ee;color:#252320;font:16px/1.5 system-ui,sans-serif}main{max-width:420px;padding:24px;text-align:center}h1{font-size:24px;margin:0 0 8px}</style>'
    + `</head><body><main><h1>${title}</h1><p>${body}</p></main>${script ? `<script nonce="${nonce}">${script}</script>` : ''}</body></html>`
}

// Runs on the localhost page: send the fragment to this server, then drop it from the address bar and history.
const HANDOFF_SCRIPT = `fetch('/done',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({payload:location.hash.slice(1)})})`
  + `.then(function(r){location.replace(r.ok?'/linked':'/failed')},function(){location.replace('/failed')})`

function send(response: ServerResponse, status: number, html: string, nonce = '') {
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; connect-src 'self'; ${nonce ? `script-src 'nonce-${nonce}'` : "script-src 'none'"}; frame-ancestors 'none'`,
  })
  response.end(html)
}

function readBody(request: IncomingMessage) {
  return new Promise<string | null>(resolve => {
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        resolve(null)
        request.destroy()
      } else chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  })
}

function sameState(expected: string, received: string) {
  const a = Buffer.from(expected)
  const b = Buffer.from(received)
  return a.length === b.length && timingSafeEqual(a, b)
}

function payloadFromBody(body: string | null) {
  try {
    const parsed: unknown = JSON.parse(body ?? '')
    if (typeof parsed !== 'object' || parsed === null || !('payload' in parsed) || typeof parsed.payload !== 'string') return null
    return decodeAgentLinkPayload(parsed.payload)
  } catch {
    return null
  }
}

/** Listens once on 127.0.0.1 for the browser to hand over approved Live activities. */
export async function startAgentLinkSession({
  appUrl,
  client,
  timeoutMs = AGENT_LINK_TIMEOUT_MS,
  createState = () => randomBytes(16).toString('hex'),
}: SessionOptions): Promise<AgentLinkSession> {
  const state = createState()
  let settle: { resolve: (payload: AgentLinkPayload) => void; reject: (error: Error) => void }
  const approval = new Promise<AgentLinkPayload>((resolve, reject) => { settle = { resolve, reject } })
  // The agent may stop waiting before the timeout; an unobserved rejection must not crash the server.
  approval.catch(() => undefined)
  let approved = false
  let origin = ''

  const server = createServer(async (request, response) => {
    if (request.headers.host !== origin.slice('http://'.length)) return send(response, 400, page('Not allowed', 'This page only answers on 127.0.0.1.'))
    const url = new URL(String(request.url), origin)
    if (request.method === 'GET' && url.pathname === '/done') {
      const nonce = randomBytes(16).toString('base64')
      return send(response, 200, page('Linking Tally…', 'One moment.', HANDOFF_SCRIPT, nonce), nonce)
    }
    if (request.method === 'GET' && url.pathname === '/linked' && approved) {
      send(response, 200, page('Tally is linked', 'Go back to your agent. You can close this tab.'))
      return finish()
    }
    if (request.method === 'GET' && url.pathname === '/failed') {
      return send(response, 400, page('Linking failed', 'Ask your agent to try linking again.'))
    }
    if (request.method === 'POST' && url.pathname === '/done' && !approved) {
      const payload = request.headers.origin === origin && request.headers['content-type'] === 'application/json'
        ? payloadFromBody(await readBody(request))
        : null
      if (!payload || !sameState(state, payload.state)) return send(response, 400, page('Linking failed', 'This approval did not match.'))
      approved = true
      settle.resolve(payload)
      response.writeHead(204, { 'cache-control': 'no-store' })
      return response.end()
    }
    send(response, 404, page('Not found', 'Nothing here.'))
  })

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  origin = `http://127.0.0.1:${port}`
  const timer = setTimeout(() => {
    settle.reject(new Error('Nobody approved the Tally link in time.'))
    finish()
  }, timeoutMs)
  timer.unref()
  function finish() {
    clearTimeout(timer)
    server.close()
    server.closeAllConnections()
  }

  const approvalUrl = new URL(appUrl)
  approvalUrl.hash = buildAgentLinkHash({ port, state, client }).slice(1)
  return {
    approvalUrl: approvalUrl.href,
    approval,
    close() {
      if (!approved) settle.reject(new Error('Linking was cancelled.'))
      finish()
    },
  }
}
