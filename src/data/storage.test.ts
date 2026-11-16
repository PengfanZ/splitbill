import { describe, expect, it } from 'vitest'
import { parseState } from './storage'

describe('stored state', () => {
  it('keeps an expense payment time across a save and reload', () => {
    const state = {
      groups: [{ id: 'trip', name: 'Trip', emoji: '✦', memberIds: ['me'] }],
      friends: [],
      expenses: [{
        id: 'dinner',
        groupId: 'trip',
        title: 'Dinner',
        amount: 10,
        payerId: 'me',
        splitMethod: 'equal' as const,
        shares: { me: 10 },
        createdAt: '2026-11-15T20:00:00.000Z',
        paidAt: '2026-11-13T19:30:00.000Z',
      }],
      selectedGroupId: 'trip',
    }

    expect(parseState(JSON.stringify(state)).expenses[0].paidAt).toBe('2026-11-13T19:30:00.000Z')
  })
})
