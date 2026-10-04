import { describe, expect, it } from 'vitest'
import { createLiveActivityMirror } from '../liveSharing/useLiveActivityMirrors'
import { TOKYO_CODE, TOKYO_TOKEN, tokyoActivity } from '../../test/mcpFixtures'
import { linkableActivities } from './linkableActivities'

const tokyoMirror = createLiveActivityMirror({ code: TOKYO_CODE, revision: 3, snapshot: tokyoActivity(), updatedAt: '2026-10-01T00:00:00.000Z' })
const skiSnapshot = { ...tokyoActivity([]), group: { ...tokyoActivity([]).group, name: 'Ski weekend', inactiveMemberIds: [] } }
const skiMirror = createLiveActivityMirror({ code: 'B1B2C3D4E5', revision: 1, snapshot: skiSnapshot, updatedAt: '2026-10-01T00:00:00.000Z' })

describe('linkableActivities', () => {
  it('lists each bookmarked Live activity once, by name, with its active members', () => {
    const { activities, unavailable } = linkableActivities(
      {
        'group-local-tokyo': { code: TOKYO_CODE, editToken: TOKYO_TOKEN },
        'live-a1b2c3d4e5': { code: TOKYO_CODE, editToken: TOKYO_TOKEN },
        'live-b1b2c3d4e5': { code: 'B1B2C3D4E5', editToken: 'b'.repeat(64) },
        'live-c1b2c3d4e5': { code: 'C1B2C3D4E5', editToken: 'c'.repeat(64) },
      },
      { 'live-a1b2c3d4e5': tokyoMirror, 'live-b1b2c3d4e5': skiMirror },
      {},
      undefined,
    )
    expect(activities.map(activity => [activity.name, activity.members.map(member => member.name)])).toEqual([
      ['Ski weekend', ['Mia', 'Leo', 'Sam', 'Ana']],
      ['Tokyo trip', ['Mia', 'Leo', 'Sam']],
    ])
    expect(activities[1]).toMatchObject({ code: TOKYO_CODE, editToken: TOKYO_TOKEN, defaultMemberId: null })
    expect(unavailable).toBe(1)
  })

  it('preselects the member chosen in this browser, else the one matching the profile name', () => {
    const bookmarks = { 'live-a1b2c3d4e5': { code: TOKYO_CODE, editToken: TOKYO_TOKEN } }
    const mirrors = { 'live-a1b2c3d4e5': tokyoMirror }
    const pick = (identities: Record<string, string>, name?: string) => linkableActivities(bookmarks, mirrors, identities, name).activities[0].defaultMemberId
    expect(pick({ [`live:${TOKYO_CODE}`]: 'friend-sam' }, 'Leo')).toBe('friend-sam')
    expect(pick({ [`live:${TOKYO_CODE}`]: 'friend-ana' }, ' leo ')).toBe('friend-leo')
    expect(pick({}, 'Ana')).toBeNull()
  })
})
