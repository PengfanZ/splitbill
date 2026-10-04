import type { ActivityIdentitySelections } from '../../data/activityIdentity'
import { isInactiveMember } from '../../domain/memberRemoval'
import type { Member } from '../../domain/models'
import type { LiveActivityBookmarks } from '../liveSharing/useLiveActivityBookmarks'
import { findLiveActivityMirrorGroupId, type LiveActivityMirrors } from '../liveSharing/useLiveActivityMirrors'

export type LinkableActivity = {
  code: string
  editToken: string
  name: string
  members: Member[]
  defaultMemberId: string | null
}

/**
 * The Live activities this browser can hand to an agent. Names and members come from the recovery copies,
 * so a bookmark that was never opened here is counted as unavailable instead of shown without members.
 */
export function linkableActivities(
  bookmarks: LiveActivityBookmarks,
  mirrors: LiveActivityMirrors,
  identities: ActivityIdentitySelections,
  identityName: string | undefined,
) {
  const activities = new Map<string, LinkableActivity>()
  let unavailable = 0
  for (const credentials of Object.values(bookmarks)) {
    if (activities.has(credentials.code)) continue
    const mirrorGroupId = findLiveActivityMirrorGroupId(mirrors, credentials.code)
    if (!mirrorGroupId) {
      unavailable += 1
      continue
    }
    const snapshot = mirrors[mirrorGroupId].snapshot
    const members = [snapshot.sender, ...snapshot.friends].filter(member => !isInactiveMember(snapshot.group, member.id))
    const savedId = identities[`live:${credentials.code}`]
    const identityKey = identityName?.trim().toLocaleLowerCase()
    const nameMatches = members.filter(member => member.name.trim().toLocaleLowerCase() === identityKey)
    const defaultMemberId = members.some(member => member.id === savedId)
      ? savedId
      : nameMatches.length === 1 ? nameMatches[0].id : null
    activities.set(credentials.code, { ...credentials, name: snapshot.group.name, members, defaultMemberId })
  }
  return {
    activities: [...activities.values()].sort((first, second) => first.name.localeCompare(second.name)),
    unavailable,
  }
}
