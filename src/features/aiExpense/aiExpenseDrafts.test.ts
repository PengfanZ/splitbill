import { describe, expect, it } from 'vitest'
import type { Member } from '../../domain/models'
import { createAiDraftFromValues, createExpenseFromAiDraft } from './aiExpenseDrafts'

const members: Member[] = [
  { id: 'me', name: 'Alex', initials: 'A', color: '#aaa' },
  { id: 'maya', name: 'Maya', initials: 'M', color: '#bbb' },
  { id: 'sam', name: 'Sam', initials: 'S', color: '#ccc' },
]

describe('AI expense draft conversion', () => {
  it('rounds editable equal values into a normalized draft and expense', () => {
    const draft = createAiDraftFromValues({
      amount: 30.015,
      equalParticipantIds: ['me', 'maya'],
      exactShares: {},
      members,
      method: 'equal',
      payerId: 'maya',
      title: '  Dinner  ',
    })
    expect(draft).toEqual({
      status: 'ready',
      title: 'Dinner',
      amountCents: 3002,
      payerId: 'maya',
      splitMethod: 'equal',
      participantIds: ['me', 'maya'],
      exactSharesCents: [],
    })
    expect(createExpenseFromAiDraft('trip', draft, members, 'expense-1', '2026-08-02T12:00:00.000Z'))
      .toEqual({
        id: 'expense-1',
        groupId: 'trip',
        title: 'Dinner',
        amount: 30.02,
        payerId: 'maya',
        splitMethod: 'equal',
        shares: { me: 15.01, maya: 15.01 },
        createdAt: '2026-08-02T12:00:00.000Z',
      })
  })

  it('keeps positive exact shares, excludes blank shares, and emits zeros for uninvolved members', () => {
    const draft = createAiDraftFromValues({
      amount: 30,
      equalParticipantIds: [],
      exactShares: { me: '10', maya: '20', sam: '', ignored: '5' },
      members,
      method: 'exact',
      payerId: 'me',
      title: 'Tickets',
    })
    expect(draft).toMatchObject({
      participantIds: ['me', 'maya'],
      exactSharesCents: [
        { memberId: 'me', amountCents: 1000 },
        { memberId: 'maya', amountCents: 2000 },
      ],
    })
    expect(createExpenseFromAiDraft('trip', draft, members, 'expense-2', '2026-08-02T12:00:00.000Z').shares)
      .toEqual({ me: 10, maya: 20, sam: 0 })
  })
})
