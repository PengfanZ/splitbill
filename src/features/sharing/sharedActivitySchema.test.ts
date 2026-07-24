import { describe, expect, it } from 'vitest'
import { CURRENT_USER } from '../../domain/members'
import { MAX_ACTIVITY_EXPENSES, sharedActivitySchema } from './sharedActivitySchema'

describe('shared activity schema', () => {
  it('rejects a structurally valid snapshot above the total byte limit', () => {
    const activity = {
      version: 2,
      sender: CURRENT_USER,
      group: { id: 'trip', name: 'Trip', emoji: '✦', memberIds: ['me'] },
      friends: [],
      expenses: Array.from({ length: MAX_ACTIVITY_EXPENSES }, (_, index) => ({
        id: `expense-${index}`,
        groupId: 'trip',
        title: 'x'.repeat(200),
        amount: 1,
        payerId: 'me',
        splitMethod: 'equal',
        shares: { me: 1 },
        createdAt: 'Today',
      })),
    }

    expect(sharedActivitySchema.safeParse(activity).success).toBe(false)
  })

  it('accepts supported activity currencies and rejects unknown codes', () => {
    const activity = {
      version: 2,
      sender: CURRENT_USER,
      group: { id: 'trip', name: 'Trip', emoji: '✦', memberIds: ['me'], currency: 'CNY' },
      friends: [],
      expenses: [],
    }

    expect(sharedActivitySchema.safeParse(activity).success).toBe(true)
    expect(sharedActivitySchema.safeParse({
      ...activity,
      group: { ...activity.group, currency: 'BTC' },
    }).success).toBe(false)
  })
})
