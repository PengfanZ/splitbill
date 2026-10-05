import { request as httpRequest } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { agentLinkCallbackUrl, parseAgentLinkHash } from './agentLinkProtocol'
import { startAgentLinkSession, type AgentLinkSession } from './agentLinkServer'

const state = '0123456789abcdef0123456789abcdef'
const activity = { code: 'A1B2C3D4E5', editToken: 'a'.repeat(64), memberId: 'me' }

type Reply = { status: number; body: string; headers: Record<string, unknown> }

function call(port: number, method: string, path: string, options: { body?: string; headers?: Record<string, string> } = {}) {
  return new Promise<Reply>((resolve, reject) => {
    const request = httpRequest({ host: '127.0.0.1', port, method, path, headers: options.headers }, response => {
      let body = ''
      response.on('data', chunk => { body += chunk })
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body, headers: response.headers }))
    })
    request.on('error', reject)
    request.end(options.body)
  })
}

const portOf = (session: AgentLinkSession) => parseAgentLinkHash(new URL(session.approvalUrl).hash)!.port
const encodedPayload = (port: number, value = state) => agentLinkCallbackUrl({ port, state, client: 'codex' }, { state: value, activities: [activity] }).split('#')[1]
const handOff = (port: number, payload: string, origin = `http://127.0.0.1:${port}`) => call(port, 'POST', '/done', {
  body: JSON.stringify({ payload }),
  headers: { origin, 'content-type': 'application/json' },
})

describe('startAgentLinkSession', () => {
  let session: AgentLinkSession | undefined

  afterEach(() => session?.close())

  it('opens the approval page in Tally with a random state', async () => {
    session = await startAgentLinkSession({ appUrl: 'https://pengfanz.github.io/splitbill/', client: 'claude-code' })
    const url = new URL(session.approvalUrl)
    expect(url.origin + url.pathname).toBe('https://pengfanz.github.io/splitbill/')
    expect(parseAgentLinkHash(url.hash)).toMatchObject({ client: 'claude-code', state: expect.stringMatching(/^[a-f0-9]{32}$/) })
  })

  it('accepts one approval from its own page, then shows the linked page and stops listening', async () => {
    session = await startAgentLinkSession({ appUrl: 'http://localhost:5173/', client: 'codex', createState: () => state })
    const port = portOf(session)

    const handoffPage = await call(port, 'GET', '/done')
    expect(handoffPage.status).toBe(200)
    expect(handoffPage.body).toContain("fetch('/done'")
    expect(String(handoffPage.headers['content-security-policy'])).toMatch(/script-src 'nonce-[^']+'/)
    expect((await call(port, 'GET', '/linked')).status).toBe(404)

    expect((await handOff(port, encodedPayload(port))).status).toBe(204)
    await expect(session.approval).resolves.toEqual({ state, activities: [activity] })
    expect((await handOff(port, encodedPayload(port))).status).toBe(404)

    const linked = await call(port, 'GET', '/linked')
    expect(linked.body).toContain('Tally is linked')
    // Follows the system theme, so it doesn't flash light after Tally's dark mode.
    expect(linked.body).toContain('<meta name="color-scheme" content="light dark">')
    expect(linked.body).toContain('@media (prefers-color-scheme:dark){body{background:#151513;color:#f3eee8}}')
    expect(String(linked.headers['content-security-policy'])).toContain("script-src 'none'")
    await expect(call(port, 'GET', '/linked')).rejects.toThrow()
  })

  it('rejects hand-offs from other origins, other states, other hosts and oversized bodies', async () => {
    session = await startAgentLinkSession({ appUrl: 'http://localhost:5173/', client: 'codex', createState: () => state })
    const port = portOf(session)

    expect((await handOff(port, encodedPayload(port), 'https://evil.example')).status).toBe(400)
    expect((await call(port, 'POST', '/done', { body: '{}', headers: { origin: `http://127.0.0.1:${port}`, 'content-type': 'text/plain' } })).status).toBe(400)
    expect((await handOff(port, encodedPayload(port, 'f'.repeat(32)))).status).toBe(400)
    expect((await handOff(port, 'garbage')).status).toBe(400)
    expect((await call(port, 'POST', '/done', { body: '[]', headers: { origin: `http://127.0.0.1:${port}`, 'content-type': 'application/json' } })).status).toBe(400)
    expect((await call(port, 'POST', '/done', { body: 'x', headers: { origin: `http://127.0.0.1:${port}`, 'content-type': 'application/json' } })).status).toBe(400)
    expect((await call(port, 'GET', '/done', { headers: { host: `localhost:${port}` } })).status).toBe(400)
    expect((await call(port, 'GET', '/failed')).body).toContain('Linking failed')
    expect((await call(port, 'GET', '/elsewhere')).status).toBe(404)
    await expect(call(port, 'POST', '/done', {
      body: JSON.stringify({ payload: 'x'.repeat(70_000) }),
      headers: { origin: `http://127.0.0.1:${port}`, 'content-type': 'application/json' },
    }).catch(() => ({ status: 400 }))).resolves.toMatchObject({ status: 400 })

    expect((await handOff(port, encodedPayload(port))).status).toBe(204)
  })

  it('gives up after the timeout or when cancelled', async () => {
    session = await startAgentLinkSession({ appUrl: 'http://localhost:5173/', client: 'other', timeoutMs: 20 })
    await expect(session.approval).rejects.toThrow('in time')

    session = await startAgentLinkSession({ appUrl: 'http://localhost:5173/', client: 'other' })
    session.close()
    await expect(session.approval).rejects.toThrow('cancelled')
  })
})
