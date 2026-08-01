import { z } from 'zod'
import { SUPPORTED_CURRENCIES } from '../../domain/currencyCodes.ts'
import { SUPPORTED_LOCALES } from '../../i18n/locales.ts'
import { MAX_ACTIVITY_AMOUNT, MAX_ACTIVITY_FRIENDS } from '../sharing/sharedActivityLimits.ts'

export const AI_EXPENSE_TEXT_MAX_LENGTH = 1_000
export const AI_EXPENSE_TITLE_MAX_LENGTH = 200
export const AI_EXPENSE_CLARIFICATION_MAX_LENGTH = 240
export const AI_EXPENSE_ANSWER_MAX_LENGTH = 200
export const AI_EXPENSE_MAX_CLARIFICATIONS = 4
export const AI_EXPENSE_MAX_MEMBERS = MAX_ACTIVITY_FRIENDS + 1
export const AI_EXPENSE_MAX_AMOUNT_CENTS = MAX_ACTIVITY_AMOUNT * 100
export const AI_EXPENSE_AUDIO_SAMPLE_RATE = 16_000
export const AI_EXPENSE_AUDIO_MAX_SECONDS = 60
export const AI_EXPENSE_AUDIO_MAX_BYTES = 44
  + AI_EXPENSE_AUDIO_SAMPLE_RATE * 2 * AI_EXPENSE_AUDIO_MAX_SECONDS
export const AI_EXPENSE_AUDIO_BASE64_MAX_LENGTH = Math.ceil(AI_EXPENSE_AUDIO_MAX_BYTES / 3) * 4

const memberSchema = z.object({
  id: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(100),
}).strict()

const clarificationContextSchema = z.object({
  question: z.string().trim().min(1).max(AI_EXPENSE_CLARIFICATION_MAX_LENGTH),
  answer: z.string().trim().min(1).max(AI_EXPENSE_ANSWER_MAX_LENGTH),
}).strict()

const requestContextSchema = z.object({
  locale: z.enum(SUPPORTED_LOCALES),
  currency: z.enum(SUPPORTED_CURRENCIES),
  members: z.array(memberSchema).min(1).max(AI_EXPENSE_MAX_MEMBERS),
  viewerMemberId: z.string().trim().min(1).max(100).optional(),
  clarification: clarificationContextSchema.optional(),
  clarifications: z.array(clarificationContextSchema).min(1).max(AI_EXPENSE_MAX_CLARIFICATIONS).optional(),
})

const textExpenseRequestSchema = requestContextSchema.extend({
  inputMode: z.literal('text'),
  text: z.string().trim().min(3).max(AI_EXPENSE_TEXT_MAX_LENGTH),
}).strict()

const voiceExpenseRequestSchema = requestContextSchema.extend({
  inputMode: z.literal('voice'),
  audio: z.object({
    data: z.string()
      .min(64)
      .max(AI_EXPENSE_AUDIO_BASE64_MAX_LENGTH)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/)
      .refine(value => value.length % 4 === 0),
    format: z.literal('wav'),
    durationSeconds: z.number().positive().max(AI_EXPENSE_AUDIO_MAX_SECONDS),
  }).strict(),
}).strict()

const normalizedRequestSchema = z.discriminatedUnion('inputMode', [
  textExpenseRequestSchema,
  voiceExpenseRequestSchema,
]).superRefine((request, context) => {
  if (request.clarification && request.clarifications) {
    context.addIssue({
      code: 'custom',
      message: 'Use either the legacy clarification or clarification history, not both.',
      path: ['clarifications'],
    })
    return
  }
  const ids = new Set<string>()
  for (const member of request.members) {
    if (ids.has(member.id)) {
      context.addIssue({
        code: 'custom',
        message: 'Member IDs must be unique.',
        path: ['members'],
      })
      return
    }
    ids.add(member.id)
  }
  if (request.viewerMemberId && !ids.has(request.viewerMemberId)) {
    context.addIssue({
      code: 'custom',
      message: 'The current participant must belong to the activity.',
      path: ['viewerMemberId'],
    })
  }
})

export const aiExpenseRequestSchema = z.preprocess(value => {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || 'inputMode' in value) return value
  return { ...value, inputMode: 'text' }
}, normalizedRequestSchema)

export type AiExpenseRequest = z.infer<typeof aiExpenseRequestSchema>
export type TextAiExpenseRequest = Extract<AiExpenseRequest, { inputMode: 'text' }>
export type VoiceAiExpenseRequest = Extract<AiExpenseRequest, { inputMode: 'voice' }>
export type AiExpenseClarification = z.infer<typeof clarificationContextSchema>

export function isVoiceAiExpenseRequest(request: AiExpenseRequest): request is VoiceAiExpenseRequest {
  return request.inputMode === 'voice'
}

export function getAiExpenseClarifications(request: AiExpenseRequest): AiExpenseClarification[] {
  if (request.clarifications) return request.clarifications
  return request.clarification ? [request.clarification] : []
}

const exactShareSchema = z.object({
  memberId: z.string(),
  amountCents: z.number().int().min(1).max(AI_EXPENSE_MAX_AMOUNT_CENTS),
}).strict()

export const aiExpenseModelOutputSchema = z.object({
  status: z.enum(['ready', 'needs_clarification']),
  title: z.string().nullable(),
  amountCents: z.number().int().nullable(),
  payerId: z.string().nullable(),
  splitMethod: z.enum(['equal', 'exact']).nullable(),
  participantIds: z.array(z.string()),
  exactSharesCents: z.array(exactShareSchema),
  clarificationQuestion: z.string().nullable(),
}).strict()

export type AiExpenseModelOutput = z.infer<typeof aiExpenseModelOutputSchema>

const readyDraftSchema = z.object({
  status: z.literal('ready'),
  title: z.string().min(1).max(AI_EXPENSE_TITLE_MAX_LENGTH),
  amountCents: z.number().int().min(1).max(AI_EXPENSE_MAX_AMOUNT_CENTS),
  payerId: z.string(),
  splitMethod: z.enum(['equal', 'exact']),
  participantIds: z.array(z.string()).min(1).max(AI_EXPENSE_MAX_MEMBERS),
  exactSharesCents: z.array(exactShareSchema).max(AI_EXPENSE_MAX_MEMBERS),
}).strict()

const clarificationSchema = z.object({
  status: z.literal('needs_clarification'),
  question: z.string().trim().min(1).max(AI_EXPENSE_CLARIFICATION_MAX_LENGTH),
}).strict()

export const aiExpenseResultSchema = z.discriminatedUnion('status', [
  readyDraftSchema,
  clarificationSchema,
])

export type AiExpenseReadyDraft = z.infer<typeof readyDraftSchema>
export type AiExpenseResult = z.infer<typeof aiExpenseResultSchema>

export class AiExpenseContractError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AiExpenseContractError'
  }
}

function unique(values: string[]) {
  return new Set(values).size === values.length
}

function sameMembers(left: string[], right: string[]) {
  if (left.length !== right.length) return false
  const rightSet = new Set(right)
  return left.every(value => rightSet.has(value))
}

export function parseAiExpenseRequest(value: unknown): AiExpenseRequest {
  const parsed = aiExpenseRequestSchema.safeParse(value)
  if (!parsed.success) throw new AiExpenseContractError('The expense description or activity context is invalid.')
  return parsed.data
}

export function parseAiExpenseResult(value: unknown): AiExpenseResult {
  const parsed = aiExpenseResultSchema.safeParse(value)
  if (!parsed.success) throw new AiExpenseContractError('The AI expense service returned an invalid draft.')
  return parsed.data
}

export function normalizeAiExpenseModelOutput(
  value: unknown,
  request: AiExpenseRequest,
): AiExpenseResult {
  const parsed = aiExpenseModelOutputSchema.safeParse(value)
  if (!parsed.success) throw new AiExpenseContractError('The model returned an invalid response shape.')
  const output = parsed.data

  if (output.status === 'needs_clarification') {
    const question = output.clarificationQuestion?.trim() ?? ''
    if (!question || question.length > AI_EXPENSE_CLARIFICATION_MAX_LENGTH) {
      throw new AiExpenseContractError('The model requested clarification without a usable question.')
    }
    return { status: 'needs_clarification', question }
  }

  const title = output.title?.trim() ?? ''
  const memberIds = new Set(request.members.map(member => member.id))
  const participantIds = output.participantIds
  if (!title
    || title.length > AI_EXPENSE_TITLE_MAX_LENGTH
    || output.amountCents === null
    || output.amountCents < 1
    || output.amountCents > AI_EXPENSE_MAX_AMOUNT_CENTS
    || output.payerId === null
    || !memberIds.has(output.payerId)
    || output.splitMethod === null
    || participantIds.length < 1
    || participantIds.length > AI_EXPENSE_MAX_MEMBERS
    || !unique(participantIds)
    || participantIds.some(memberId => !memberIds.has(memberId))) {
    throw new AiExpenseContractError('The model draft does not match the current activity.')
  }

  if (output.splitMethod === 'equal') {
    if (output.exactSharesCents.length !== 0) {
      throw new AiExpenseContractError('An equal split must not contain exact shares.')
    }
  } else {
    const exactIds = output.exactSharesCents.map(share => share.memberId)
    const exactTotal = output.exactSharesCents.reduce((total, share) => total + share.amountCents, 0)
    if (!unique(exactIds)
      || exactIds.some(memberId => !memberIds.has(memberId))
      || !sameMembers(participantIds, exactIds)
      || exactTotal !== output.amountCents) {
      throw new AiExpenseContractError('The exact shares must match the expense total and activity members.')
    }
  }

  return {
    status: 'ready',
    title,
    amountCents: output.amountCents,
    payerId: output.payerId,
    splitMethod: output.splitMethod,
    participantIds,
    exactSharesCents: output.exactSharesCents,
  }
}
