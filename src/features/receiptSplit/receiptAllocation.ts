import type { Expense, Member } from '../../domain/models'
import type { ReceiptCharge, ReceiptDraft } from './receiptContract'

export type ReceiptAssignment = Record<string, string[]>
export type ReceiptChargeAllocationMethod = 'proportional' | 'equal'
export type ReceiptChargeSetting = ReceiptCharge & {
  allocationMethod: ReceiptChargeAllocationMethod
}

export type MemberReceiptTotal = {
  memberId: string
  foodCents: number
  chargeCents: number
  totalCents: number
}

export type ReceiptSplitResult = {
  members: MemberReceiptTotal[]
  totalCents: number
  shares: Record<string, number>
}

function unique(values: string[]) {
  return [...new Set(values)]
}

export function allocateCentsByWeight(amountCents: number, weights: Array<{ id: string; weight: number }>) {
  if (!Number.isSafeInteger(amountCents)) throw new RangeError('Amount must use integer cents.')
  if (!weights.length || weights.some(item => !Number.isSafeInteger(item.weight) || item.weight < 0)) {
    throw new RangeError('Allocation weights must be non-negative integers.')
  }
  const totalWeight = weights.reduce((total, item) => total + item.weight, 0)
  if (totalWeight <= 0) throw new RangeError('Allocation requires a positive weight.')

  const sign = amountCents < 0 ? -1 : 1
  const absoluteAmount = BigInt(Math.abs(amountCents))
  const denominator = BigInt(totalWeight)
  const rows = weights.map((item, index) => {
    const numerator = absoluteAmount * BigInt(item.weight)
    return {
      ...item,
      index,
      cents: numerator / denominator,
      remainder: numerator % denominator,
    }
  })
  let remaining = absoluteAmount - rows.reduce((total, item) => total + item.cents, 0n)
  const order = [...rows].sort((left, right) => {
    if (left.remainder === right.remainder) return left.index - right.index
    return left.remainder > right.remainder ? -1 : 1
  })
  for (let index = 0; index < order.length && remaining > 0n; index += 1) {
    order[index].cents += 1n
    remaining -= 1n
  }
  return Object.fromEntries(rows.map(item => [item.id, sign * Number(item.cents)]))
}

function validateAssignments(draft: ReceiptDraft, members: Member[], assignments: ReceiptAssignment) {
  const memberIds = new Set(members.map(member => member.id))
  if (memberIds.size !== members.length) throw new Error('Activity members must be unique.')
  for (const item of draft.items) {
    const assignees = unique(assignments[item.id] ?? [])
    if (!assignees.length || assignees.some(memberId => !memberIds.has(memberId))) {
      throw new Error(`Assign ${item.name} to at least one activity member.`)
    }
  }
}

export function calculateReceiptSplit(
  draft: ReceiptDraft,
  members: Member[],
  assignments: ReceiptAssignment,
  charges: ReceiptChargeSetting[],
): ReceiptSplitResult {
  validateAssignments(draft, members, assignments)
  const foodByMember = Object.fromEntries(members.map(member => [member.id, 0]))

  for (const item of draft.items) {
    const assignees = unique(assignments[item.id])
    const itemShares = allocateCentsByWeight(
      item.totalCents,
      assignees.map(memberId => ({ id: memberId, weight: 1 })),
    )
    for (const [memberId, cents] of Object.entries(itemShares)) foodByMember[memberId] += cents
  }

  const participatingMembers = members.filter(member => foodByMember[member.id] > 0)
  if (!participatingMembers.length) throw new Error('Receipt split requires at least one participant.')
  const chargeByMember = Object.fromEntries(members.map(member => [member.id, 0]))
  for (const charge of charges) {
    const weights = participatingMembers.map(member => ({
      id: member.id,
      weight: charge.allocationMethod === 'equal' ? 1 : foodByMember[member.id],
    }))
    const allocated = allocateCentsByWeight(charge.amountCents, weights)
    for (const [memberId, cents] of Object.entries(allocated)) chargeByMember[memberId] += cents
  }

  const memberTotals = members.map(member => {
    const foodCents = foodByMember[member.id]
    const chargeCents = chargeByMember[member.id]
    const totalCents = foodCents + chargeCents
    if (totalCents < 0) throw new RangeError('A receipt discount cannot make a person total negative.')
    return { memberId: member.id, foodCents, chargeCents, totalCents }
  })
  const totalCents = memberTotals.reduce((total, member) => total + member.totalCents, 0)
  return {
    members: memberTotals,
    totalCents,
    shares: Object.fromEntries(memberTotals
      .filter(member => member.totalCents > 0)
      .map(member => [member.memberId, member.totalCents / 100])),
  }
}

export function createExpenseFromReceiptSplit({
  createdAt,
  groupId,
  id,
  payerId,
  result,
  title,
}: {
  createdAt: string
  groupId: string
  id: string
  payerId: string
  result: ReceiptSplitResult
  title: string
}): Expense {
  if (!Object.keys(result.shares).length) {
    throw new Error('Receipt expense requires valid shares.')
  }
  return {
    id,
    groupId,
    title: title.trim() || 'Receipt',
    amount: result.totalCents / 100,
    payerId,
    splitMethod: 'exact',
    shares: result.shares,
    createdAt,
    category: 'food',
  }
}
