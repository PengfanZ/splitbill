import { z } from 'zod'
import { SUPPORTED_CURRENCIES } from '../../domain/currency'
import type { ActivityGroup, Expense, Member } from '../../domain/models'

export const MAX_ACTIVITY_SNAPSHOT_BYTES = 128 * 1024
export const MAX_ACTIVITY_FRIENDS = 100
export const MAX_ACTIVITY_EXPENSES = 1_000
export const MAX_ACTIVITY_AMOUNT = 1_000_000_000

const memberIdSchema = z.string().min(1).max(120)
const memberSchema = z.object({
  id: memberIdSchema,
  name: z.string().min(1).max(120),
  initials: z.string().min(1).max(12),
  color: z.string().min(1).max(32),
}).passthrough()
const groupSchema = z.object({
  id: z.string().min(1).max(120),
  name: z.string().min(1).max(120),
  emoji: z.string().min(1).max(16),
  memberIds: z.array(memberIdSchema).min(1).max(MAX_ACTIVITY_FRIENDS + 1),
  currency: z.enum(SUPPORTED_CURRENCIES).optional(),
}).passthrough()
const amountSchema = z.number().min(0).max(MAX_ACTIVITY_AMOUNT)
const expenseSchema = z.object({
  id: z.string().min(1).max(120),
  groupId: z.string().min(1).max(120),
  title: z.string().min(1).max(200),
  amount: amountSchema,
  payerId: memberIdSchema,
  splitMethod: z.enum(['equal', 'exact']),
  shares: z.record(memberIdSchema, amountSchema),
  createdAt: z.string(),
  updatedAt: z.string().refine(value => Number.isFinite(Date.parse(value))).optional(),
  kind: z.enum(['expense', 'settlement']).optional(),
}).passthrough().superRefine((expense, context) => {
  if (expense.kind !== 'settlement') return
  const recipients = Object.entries(expense.shares)
  if (expense.amount <= 0
    || expense.splitMethod !== 'exact'
    || recipients.length !== 1
    || recipients[0][0] === expense.payerId
    || Math.abs(recipients[0][1] - expense.amount) >= 0.005) {
    context.addIssue({ code: 'custom', message: 'Invalid settlement payment' })
  }
})

const activityDataShape = {
  group: groupSchema,
  friends: z.array(memberSchema).max(MAX_ACTIVITY_FRIENDS),
  expenses: z.array(expenseSchema).max(MAX_ACTIVITY_EXPENSES),
}

function validateActivityReferences(
  activity: z.infer<z.ZodObject<typeof activityDataShape>>,
  context: z.RefinementCtx,
) {
  const memberIds = new Set(['me', ...activity.friends.map(friend => friend.id)])
  const valid = activity.group.memberIds.every(memberId => memberIds.has(memberId))
    && activity.expenses.every(expense => expense.groupId === activity.group.id
      && memberIds.has(expense.payerId)
      && Object.keys(expense.shares).every(memberId => memberIds.has(memberId)))
  if (!valid) context.addIssue({ code: 'custom', message: 'Invalid activity references' })
}

export const legacySharedActivitySchema = z.object({
  version: z.literal(1),
  ...activityDataShape,
}).passthrough().superRefine(validateActivityReferences)

export const sharedActivitySchema = z.object({
  version: z.literal(2),
  sender: memberSchema.extend({ id: z.literal('me') }),
  ...activityDataShape,
}).passthrough().superRefine((activity, context) => {
  validateActivityReferences(activity, context)
  if (new TextEncoder().encode(JSON.stringify(activity)).byteLength > MAX_ACTIVITY_SNAPSHOT_BYTES) {
    context.addIssue({ code: 'custom', message: 'Activity snapshot is too large' })
  }
})

export type SharedActivity = {
  version: 2
  sender: Member
  group: ActivityGroup
  friends: Member[]
  expenses: Expense[]
}
