import { createEqualShares, createExpenseTimestamp } from '../../domain/expenses'
import { makeId } from '../../domain/members'
import type { Expense, Member, SplitMethod } from '../../domain/models'
import type { AiExpenseReadyDraft } from './aiExpenseContract'

export function createAiDraftFromValues({
  amount,
  equalParticipantIds,
  exactShares,
  members,
  method,
  payerId,
  title,
}: {
  amount: number
  equalParticipantIds: string[]
  exactShares: Record<string, string>
  members: Member[]
  method: SplitMethod
  payerId: string
  title: string
}): AiExpenseReadyDraft {
  const amountCents = Math.round(amount * 100)
  const exactSharesCents = method === 'exact'
    ? members.flatMap(member => {
        const cents = Math.round((Number(exactShares[member.id]) || 0) * 100)
        return cents > 0 ? [{ memberId: member.id, amountCents: cents }] : []
      })
    : []
  return {
    status: 'ready',
    title: title.trim(),
    amountCents,
    payerId,
    splitMethod: method,
    participantIds: method === 'equal'
      ? [...equalParticipantIds]
      : exactSharesCents.map(share => share.memberId),
    exactSharesCents,
  }
}

export function createExpenseFromAiDraft(
  groupId: string,
  draft: AiExpenseReadyDraft,
  members: Member[],
  id = makeId('expense'),
  createdAt = createExpenseTimestamp(),
): Expense {
  const amount = draft.amountCents / 100
  const shares = draft.splitMethod === 'equal'
    ? createEqualShares(members.filter(member => draft.participantIds.includes(member.id)), amount)
    : Object.fromEntries(members.map(member => {
        const share = draft.exactSharesCents.find(item => item.memberId === member.id)
        return [member.id, (share?.amountCents ?? 0) / 100]
      }))
  return {
    id,
    groupId,
    title: draft.title,
    amount,
    payerId: draft.payerId,
    splitMethod: draft.splitMethod,
    shares,
    createdAt,
  }
}
