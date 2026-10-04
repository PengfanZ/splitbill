import { describe, expect, it } from 'vitest'
import {
  agentClientFromName,
  agentLinkCallbackUrl,
  buildAgentLinkHash,
  decodeAgentLinkPayload,
  parseAgentLinkHash,
} from './agentLinkProtocol'

const state = '0123456789abcdef0123456789abcdef'
const activity = { code: 'A1B2C3D4E5', editToken: 'a'.repeat(64), memberId: 'friend-ÿ-名' }

describe('agent link requests', () => {
  it('round-trips the approval hash', () => {
    const hash = buildAgentLinkHash({ port: 51234, state, client: 'codex' })
    expect(hash).toBe(`#agent-link=51234.${state}.codex`)
    expect(parseAgentLinkHash(hash)).toEqual({ port: 51234, state, client: 'codex' })
  })

  it('rejects anything that is not exactly a local port, a state and a known client', () => {
    for (const hash of [
      '#live=A1B2C3D4E5.' + 'a'.repeat(64),
      `#agent-link=80.${state}.codex`,
      `#agent-link=70000.${state}.codex`,
      `#agent-link=5123x.${state}.codex`,
      `#agent-link=51234.${state.toUpperCase()}.codex`,
      `#agent-link=51234.${state}.chatgpt`,
      `#agent-link=51234.${state}.codex.extra`,
      '#agent-link=51234',
      `#agent-link=51234.${state}`,
    ]) expect(parseAgentLinkHash(hash)).toBeNull()
  })

  it('names the client family from the MCP handshake', () => {
    expect(agentClientFromName('claude-code')).toBe('claude-code')
    expect(agentClientFromName('Codex CLI')).toBe('codex')
    expect(agentClientFromName('cursor')).toBe('other')
    expect(agentClientFromName(undefined)).toBe('other')
  })
})

describe('agent link payloads', () => {
  it('encodes credentials into the localhost fragment and decodes them back', () => {
    const url = agentLinkCallbackUrl({ port: 51234, state, client: 'claude-code' }, { state, activities: [activity] })
    expect(url.startsWith('http://127.0.0.1:51234/done#')).toBe(true)
    expect(url).not.toContain(activity.editToken)
    expect(decodeAgentLinkPayload(url.split('#')[1])).toEqual({ state, activities: [activity] })
  })

  it('refuses to build or accept malformed payloads', () => {
    expect(() => agentLinkCallbackUrl({ port: 51234, state, client: 'codex' }, { state, activities: [] })).toThrow()
    expect(decodeAgentLinkPayload('not base64!')).toBeNull()
    expect(decodeAgentLinkPayload(btoa('{"state":"x"}'))).toBeNull()
    expect(decodeAgentLinkPayload(btoa('not json'))).toBeNull()
  })
})
