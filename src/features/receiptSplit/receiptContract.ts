import { z } from 'zod'
import { SUPPORTED_CURRENCIES, type CurrencyCode } from '../../domain/currencyCodes.ts'

export const MAX_RECEIPT_ITEMS = 200
export const MAX_RECEIPT_DETAILS_PER_ITEM = 40
export const MAX_RECEIPT_CHARGES = 20
export const MAX_RECEIPT_AMOUNT_CENTS = 100_000_000_000
export const MAX_RECEIPT_IMAGE_BYTES = 5 * 1024 * 1024
export const MAX_RECEIPT_UPLOAD_BYTES = 3 * 1024 * 1024
export const MAX_RECEIPT_IMAGE_PIXELS = 40_000_000
export const MAX_RECEIPT_LONG_EDGE = 2_048

const centsSchema = z.number().int().min(-MAX_RECEIPT_AMOUNT_CENTS).max(MAX_RECEIPT_AMOUNT_CENTS)
const positiveCentsSchema = centsSchema.min(0)

export const receiptDetailSchema = z.object({
  kind: z.enum(['modifier', 'add-on', 'discount', 'included', 'note', 'unknown']),
  label: z.string().trim().min(1).max(200),
  amountCents: centsSchema.nullable(),
}).strict()

export const receiptItemSchema = z.object({
  id: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(200),
  quantity: z.number().int().min(1).max(100),
  unitPriceCents: positiveCentsSchema.nullable(),
  totalCents: positiveCentsSchema,
  details: z.array(receiptDetailSchema).max(MAX_RECEIPT_DETAILS_PER_ITEM),
  sourceLines: z.array(z.string().trim().min(1).max(300)).max(30),
  confidence: z.enum(['high', 'medium', 'low']),
}).strict()

export const receiptChargeSchema = z.object({
  id: z.string().trim().min(1).max(120),
  type: z.enum(['tax', 'tip', 'service', 'discount', 'other']),
  label: z.string().trim().min(1).max(120),
  amountCents: centsSchema,
  rateBasisPoints: z.number().int().min(0).max(100_000).nullable(),
  confidence: z.enum(['high', 'medium', 'low']),
}).strict().superRefine((charge, context) => {
  if (charge.type === 'discount' ? charge.amountCents > 0 : charge.amountCents < 0) {
    context.addIssue({ code: 'custom', message: 'Charge amount has the wrong sign.' })
  }
})

export const receiptDraftSchema = z.object({
  version: z.literal(1),
  merchant: z.string().trim().min(1).max(200).nullable(),
  currency: z.enum(SUPPORTED_CURRENCIES).nullable(),
  purchasedAt: z.string().trim().min(1).max(120).nullable(),
  items: z.array(receiptItemSchema).min(1).max(MAX_RECEIPT_ITEMS),
  charges: z.array(receiptChargeSchema).max(MAX_RECEIPT_CHARGES),
  subtotalCents: positiveCentsSchema,
  totalCents: positiveCentsSchema,
  unresolvedLines: z.array(z.string().trim().min(1).max(300)).max(50),
}).strict().superRefine((draft, context) => {
  const itemIds = draft.items.map(item => item.id)
  const chargeIds = draft.charges.map(charge => charge.id)
  if (new Set(itemIds).size !== itemIds.length || new Set(chargeIds).size !== chargeIds.length) {
    context.addIssue({ code: 'custom', message: 'Receipt line IDs must be unique.' })
  }
})

export const parseReceiptRequestSchema = z.object({
  image: z.object({
    dataUrl: z.string().min(1).max(Math.ceil(MAX_RECEIPT_UPLOAD_BYTES * 4 / 3) + 128),
    width: z.number().int().min(1).max(MAX_RECEIPT_LONG_EDGE),
    height: z.number().int().min(1).max(MAX_RECEIPT_LONG_EDGE),
  }).strict(),
  locale: z.enum(['en', 'zh-CN']),
  currency: z.enum(SUPPORTED_CURRENCIES),
}).strict()

export type ReceiptDetail = z.infer<typeof receiptDetailSchema>
export type ReceiptItem = z.infer<typeof receiptItemSchema>
export type ReceiptCharge = z.infer<typeof receiptChargeSchema>
export type ReceiptDraft = z.infer<typeof receiptDraftSchema>
export type ParseReceiptRequest = z.infer<typeof parseReceiptRequestSchema>

export type ReceiptReconciliation = {
  itemsCents: number
  chargesCents: number
  calculatedTotalCents: number
  subtotalDifferenceCents: number
  totalDifferenceCents: number
  matches: boolean
}

export function parseReceiptDraft(value: unknown) {
  return receiptDraftSchema.parse(value)
}

export function parseReceiptRequest(value: unknown) {
  return parseReceiptRequestSchema.parse(value)
}

export function reconcileReceipt(draft: ReceiptDraft): ReceiptReconciliation {
  const itemsCents = draft.items.reduce((total, item) => total + item.totalCents, 0)
  const chargesCents = draft.charges.reduce((total, charge) => total + charge.amountCents, 0)
  const calculatedTotalCents = itemsCents + chargesCents
  const subtotalDifferenceCents = draft.subtotalCents - itemsCents
  const totalDifferenceCents = draft.totalCents - calculatedTotalCents
  return {
    itemsCents,
    chargesCents,
    calculatedTotalCents,
    subtotalDifferenceCents,
    totalDifferenceCents,
    matches: subtotalDifferenceCents === 0 && totalDifferenceCents === 0,
  }
}

export function receiptCurrency(draft: ReceiptDraft, fallback: CurrencyCode) {
  return draft.currency ?? fallback
}
