import { describe, expect, it } from 'vitest'
import type { Member } from '../../domain/models'
import { receiptDraftFixture } from './receiptContract.test'
import {
  allocateCentsByWeight,
  calculateReceiptSplit,
  createExpenseFromReceiptSplit,
  type ReceiptChargeSetting,
} from './receiptAllocation'

const members: Member[] = [
  { id: 'a', name: 'A', initials: 'A', color: '#111' },
  { id: 'b', name: 'B', initials: 'B', color: '#222' },
  { id: 'c', name: 'C', initials: 'C', color: '#333' },
]

describe('receipt allocation', () => {
  it('uses stable largest-remainder allocation for positive, negative, and large amounts', () => {
    expect(allocateCentsByWeight(5, [{ id: 'a', weight: 1 }, { id: 'b', weight: 1 }])).toEqual({ a: 3, b: 2 })
    expect(allocateCentsByWeight(1, [{ id: 'a', weight: 1 }, { id: 'b', weight: 2 }])).toEqual({ a: 0, b: 1 })
    expect(allocateCentsByWeight(-5, [{ id: 'a', weight: 1 }, { id: 'b', weight: 1 }])).toEqual({ a: -3, b: -2 })
    expect(allocateCentsByWeight(100_000_000_000, [{ id: 'a', weight: 2 }, { id: 'b', weight: 1 }])).toEqual({ a: 66_666_666_667, b: 33_333_333_333 })
  })

  it('rejects invalid amounts and weights', () => {
    expect(() => allocateCentsByWeight(1.2, [{ id: 'a', weight: 1 }])).toThrow('integer cents')
    expect(() => allocateCentsByWeight(1, [])).toThrow('non-negative integers')
    expect(() => allocateCentsByWeight(1, [{ id: 'a', weight: -1 }])).toThrow('non-negative integers')
    expect(() => allocateCentsByWeight(1, [{ id: 'a', weight: 0 }])).toThrow('positive weight')
  })

  it('splits dishes and allocates charges proportionally or equally', () => {
    const proportionalCharges: ReceiptChargeSetting[] = receiptDraftFixture.charges.map(charge => ({
      ...charge,
      allocationMethod: 'proportional',
    }))
    const result = calculateReceiptSplit(receiptDraftFixture, members, {
      'item-1': ['a'],
      'item-2': ['b', 'c', 'b'],
    }, proportionalCharges)
    expect(result.members).toEqual([
      { memberId: 'a', foodCents: 2_000, chargeCents: 160, totalCents: 2_160 },
      { memberId: 'b', foodCents: 600, chargeCents: 48, totalCents: 648 },
      { memberId: 'c', foodCents: 600, chargeCents: 48, totalCents: 648 },
    ])
    expect(result.totalCents).toBe(3_456)
    expect(result.shares).toEqual({ a: 21.6, b: 6.48, c: 6.48 })

    const equal = calculateReceiptSplit(receiptDraftFixture, members, {
      'item-1': ['a'],
      'item-2': ['b'],
    }, proportionalCharges.map(charge => ({ ...charge, allocationMethod: 'equal' })))
    expect(equal.members.map(member => member.chargeCents)).toEqual([128, 128, 0])
  })

  it('rejects invalid members, assignments, negative totals, and reconciliation failures', () => {
    const assignments = { 'item-1': ['a'], 'item-2': ['b'] }
    expect(() => calculateReceiptSplit(receiptDraftFixture, [members[0], members[0]], assignments, [])).toThrow('must be unique')
    expect(() => calculateReceiptSplit(receiptDraftFixture, members, { ...assignments, 'item-1': [] }, [])).toThrow('Assign Ramen')
    expect(() => calculateReceiptSplit(receiptDraftFixture, members, { 'item-1': ['a'] }, [])).toThrow('Assign Bao')
    expect(() => calculateReceiptSplit(receiptDraftFixture, members, { ...assignments, 'item-1': ['missing'] }, [])).toThrow('Assign Ramen')
    expect(() => calculateReceiptSplit(receiptDraftFixture, members, assignments, [{
      ...receiptDraftFixture.charges[0],
      type: 'discount',
      amountCents: -4_000,
      allocationMethod: 'proportional',
    }])).toThrow('cannot make a person total negative')

    const brokenDraft = { ...receiptDraftFixture, items: [] }
    expect(() => calculateReceiptSplit(brokenDraft, members, {}, [])).toThrow('at least one participant')
  })

  it('creates a valid exact-split expense', () => {
    const result = { members: [], totalCents: 1_234, shares: { a: 12.34 } }
    expect(createExpenseFromReceiptSplit({
      createdAt: '2026-08-22T00:00:00.000Z',
      groupId: 'group-1',
      id: 'expense-1',
      payerId: 'b',
      result,
      title: '  ',
    })).toEqual({
      id: 'expense-1',
      groupId: 'group-1',
      title: 'Receipt',
      amount: 12.34,
      payerId: 'b',
      splitMethod: 'exact',
      shares: { a: 12.34 },
      createdAt: '2026-08-22T00:00:00.000Z',
      category: 'food',
    })
    expect(() => createExpenseFromReceiptSplit({
      createdAt: '', groupId: '', id: '', payerId: 'a', result: { ...result, shares: {} }, title: '',
    })).toThrow('valid shares')
  })
})
