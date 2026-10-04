import { isInactiveMember } from '../../domain/memberRemoval'
import { LiveActivityApiError } from '../liveSharing/liveActivityApi'
import type { LiveActivityClient } from '../liveSharing/liveActivityConfig'
import type { AgentLinkPayload } from './agentLinkProtocol'
import type { CredentialStore } from './credentialStore'
import { activityMembers, McpToolError } from './mcpActivity'

export type LinkOutcome = {
  linked: { name: string; you: string }[]
  failed: { code: string; reason: string }[]
}

function reasonFor(error: unknown) {
  if (error instanceof McpToolError) return error.message
  if (error instanceof LiveActivityApiError && error.kind === 'not-found') return 'Tally could not find it. Live sharing may have ended.'
  return 'Tally could not be reached. Try again in a moment.'
}

/** Checks each approved activity against Tally, then remembers it on this computer. */
export async function linkApprovedActivities(
  payload: AgentLinkPayload,
  client: Pick<LiveActivityClient, 'load'>,
  store: CredentialStore,
  now: Date,
): Promise<LinkOutcome> {
  const outcome: LinkOutcome = { linked: [], failed: [] }
  for (const approved of payload.activities) {
    try {
      const record = await client.load({ code: approved.code, editToken: approved.editToken })
      const member = activityMembers(record.snapshot).find(item => item.id === approved.memberId)
      if (!member || isInactiveMember(record.snapshot.group, member.id)) throw new McpToolError('The chosen member is no longer in this activity.')
      await store.save({ ...approved, name: record.snapshot.group.name, linkedAt: now.toISOString() })
      outcome.linked.push({ name: record.snapshot.group.name, you: member.name })
    } catch (error) {
      outcome.failed.push({ code: approved.code, reason: reasonFor(error) })
    }
  }
  return outcome
}
