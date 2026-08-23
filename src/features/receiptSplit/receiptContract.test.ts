import { describe, expect, it } from 'vitest'
import {
  parseReceiptDraft,
  parseReceiptRequest,
  receiptCurrency,
  reconcileReceipt,
  type ReceiptDraft,
} from './receiptContract'

export const receiptDraftFixture: ReceiptDraft = {
  version: 1,
  merchant: 'Bao Button',
  currency: 'USD',
  purchasedAt: '2026-08-22',
  items: [
    {
      id: 'item-1',
      name: 'Ramen',
      quantity: 1,
      unitPriceCents: 1_800,
      totalCents: 2_000,
      details: [{ kind: 'add-on', label: 'Egg', amountCents: 200 }],
      sourceLines: ['Ramen 18.00', 'Egg 2.00'],
      confidence: 'high',
    },
    {
      id: 'item-2',
      name: 'Bao',
      quantity: 2,
      unitPriceCents: 600,
      totalCents: 1_200,
      details: [],
      sourceLines: ['2 Bao 12.00'],
      confidence: 'medium',
    },
  ],
  charges: [{
    id: 'charge-1',
    type: 'tax',
    label: 'Tax 8%',
    amountCents: 256,
    rateBasisPoints: 800,
    confidence: 'high',
  }],
  subtotalCents: 3_200,
  totalCents: 3_456,
  unresolvedLines: [],
}

describe('receipt contract', () => {
  it('parses a valid receipt and request', () => {
    expect(parseReceiptDraft(receiptDraftFixture)).toEqual(receiptDraftFixture)
    const request = {
      image: { dataUrl: 'data:image/jpeg;base64,QQ==', width: 1, height: 1 },
      locale: 'en' as const,
      currency: 'USD' as const,
    }
    expect(parseReceiptRequest(request)).toEqual(request)
  })

  it('rejects duplicate line ids and invalid charge signs', () => {
    expect(() => parseReceiptDraft({
      ...receiptDraftFixture,
      items: [receiptDraftFixture.items[0], receiptDraftFixture.items[0]],
    })).toThrow('Receipt line IDs must be unique')
    expect(() => parseReceiptDraft({
      ...receiptDraftFixture,
      charges: [{ ...receiptDraftFixture.charges[0], amountCents: -1 }],
    })).toThrow('Charge amount has the wrong sign')
    expect(() => parseReceiptDraft({
      ...receiptDraftFixture,
      charges: [{ ...receiptDraftFixture.charges[0], type: 'discount', amountCents: 1 }],
    })).toThrow('Charge amount has the wrong sign')
  })

  it('accepts negative discounts and reports reconciliation mismatches', () => {
    const draft = parseReceiptDraft({
      ...receiptDraftFixture,
      charges: [{ ...receiptDraftFixture.charges[0], type: 'discount', amountCents: -100 }],
      subtotalCents: 3_201,
      totalCents: 3_101,
    })
    expect(reconcileReceipt(draft)).toEqual({
      itemsCents: 3_200,
      chargesCents: -100,
      calculatedTotalCents: 3_100,
      subtotalDifferenceCents: 1,
      totalDifferenceCents: 1,
      matches: false,
    })
  })

  it('reconciles an exact receipt and resolves its currency', () => {
    expect(reconcileReceipt(receiptDraftFixture).matches).toBe(true)
    expect(receiptCurrency(receiptDraftFixture, 'CNY')).toBe('USD')
    expect(receiptCurrency({ ...receiptDraftFixture, currency: null }, 'CNY')).toBe('CNY')
  })
})
