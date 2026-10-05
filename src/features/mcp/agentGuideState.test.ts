import { afterEach, describe, expect, it, vi } from 'vitest'
import { isAgentGuideHash, loadGuideClient, saveGuideClient } from './agentGuideState'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('agent guide preferences', () => {
  it('remembers the chosen agent and defaults to Claude Code', () => {
    expect(loadGuideClient()).toBe('claude-code')
    saveGuideClient('codex')
    expect(localStorage.getItem('tally:agent-guide-client:v1')).toBe('codex')
    expect(loadGuideClient()).toBe('codex')
    localStorage.setItem('tally:agent-guide-client:v1', 'cursor')
    expect(loadGuideClient()).toBe('claude-code')
  })

  it('keeps working when browser storage throws', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    expect(loadGuideClient()).toBe('claude-code')
    expect(() => saveGuideClient('codex')).not.toThrow()
  })
})

describe('isAgentGuideHash', () => {
  it('recognizes only the #agents link', () => {
    expect(isAgentGuideHash('#agents')).toBe(true)
    expect(isAgentGuideHash('#Agents')).toBe(false)
    expect(isAgentGuideHash('#agents/extra')).toBe(false)
    expect(isAgentGuideHash(`#live=A1B2C3D4E5.${'a'.repeat(64)}`)).toBe(false)
    expect(isAgentGuideHash('')).toBe(false)
  })
})
