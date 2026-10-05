/** Browser-side state for the "Use with AI agents" guide: the remembered agent tab and the shareable #agents link. */

export const AGENT_GUIDE_CLIENT_KEY = 'tally:agent-guide-client:v1'
export const AGENT_GUIDE_HASH = '#agents'

export type GuideClient = 'claude-code' | 'codex'

export function loadGuideClient(): GuideClient {
  try {
    return localStorage.getItem(AGENT_GUIDE_CLIENT_KEY) === 'codex' ? 'codex' : 'claude-code'
  } catch {
    return 'claude-code'
  }
}

export function saveGuideClient(client: GuideClient) {
  try {
    localStorage.setItem(AGENT_GUIDE_CLIENT_KEY, client)
  } catch {
    // Remembering the tab is a convenience; blocked storage just means it isn't remembered.
  }
}

export function isAgentGuideHash(hash: string) {
  return hash === AGENT_GUIDE_HASH
}
