import { describe, expect, it, vi } from 'vitest'
import { LiveActivityApiError } from '../liveSharing/liveActivityApi'
import { TOKYO_CODE, TOKYO_TOKEN, tokyoActivity } from '../../test/mcpFixtures'
import type { CredentialStore } from './credentialStore'
import { linkApprovedActivities } from './linkActivities'

const state = '0123456789abcdef0123456789abcdef'

describe('linkApprovedActivities', () => {
  it('saves activities that still exist with an active member, and explains the rest', async () => {
    const store: CredentialStore = { filePath: '', list: vi.fn(), save: vi.fn(async () => undefined), remove: vi.fn() }
    const load = vi.fn(async ({ code }: { code: string }) => {
      if (code === 'DEADBEEF00') throw new LiveActivityApiError('not-found', 'Gone')
      if (code === 'BADC0FFEE0') throw new LiveActivityApiError('network', 'Offline')
      return { code, revision: 1, snapshot: tokyoActivity(), updatedAt: '' }
    })
    const now = new Date('2026-10-04T09:30:00.000Z')

    const outcome = await linkApprovedActivities({
      state,
      activities: [
        { code: TOKYO_CODE, editToken: TOKYO_TOKEN, memberId: 'friend-leo' },
        { code: TOKYO_CODE, editToken: TOKYO_TOKEN, memberId: 'friend-ana' },
        { code: TOKYO_CODE, editToken: TOKYO_TOKEN, memberId: 'friend-zoe' },
        { code: 'DEADBEEF00', editToken: 'd'.repeat(64), memberId: 'me' },
        { code: 'BADC0FFEE0', editToken: 'b'.repeat(64), memberId: 'me' },
      ],
    }, { load }, store, now)

    expect(outcome).toEqual({
      linked: [{ name: 'Tokyo trip', you: 'Leo' }],
      failed: [
        { code: TOKYO_CODE, reason: 'The chosen member is no longer in this activity.' },
        { code: TOKYO_CODE, reason: 'The chosen member is no longer in this activity.' },
        { code: 'DEADBEEF00', reason: 'Tally could not find it. Live sharing may have ended.' },
        { code: 'BADC0FFEE0', reason: 'Tally could not be reached. Try again in a moment.' },
      ],
    })
    expect(store.save).toHaveBeenCalledExactlyOnceWith({
      code: TOKYO_CODE, editToken: TOKYO_TOKEN, memberId: 'friend-leo', name: 'Tokyo trip', linkedAt: now.toISOString(),
    })
  })
})
