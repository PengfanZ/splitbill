import { describe, expect, it } from 'vitest'
import {
  AI_EXPENSE_MAX_AMOUNT_CENTS,
  AI_EXPENSE_MAX_MEMBERS,
  AI_EXPENSE_ANSWER_MAX_LENGTH,
  AI_EXPENSE_CLARIFICATION_MAX_LENGTH,
  AI_EXPENSE_TEXT_MAX_LENGTH,
  AI_EXPENSE_TITLE_MAX_LENGTH,
  AiExpenseContractError,
  normalizeAiExpenseModelOutput,
  parseAiExpenseRequest,
  parseAiExpenseResult,
  type AiExpenseModelOutput,
  type AiExpenseRequest,
} from './aiExpenseContract'

const request: AiExpenseRequest = {
  text: 'Maya paid $30 for dinner, split with me',
  locale: 'en',
  currency: 'USD',
  members: [
    { id: 'me', name: 'Alex' },
    { id: 'maya', name: 'Maya' },
  ],
}

const equalOutput: AiExpenseModelOutput = {
  status: 'ready',
  title: 'Dinner',
  amountCents: 3000,
  payerId: 'maya',
  splitMethod: 'equal',
  participantIds: ['me', 'maya'],
  exactSharesCents: [],
  clarificationQuestion: null,
}

function expectContractError(action: () => unknown) {
  expect(action).toThrow(AiExpenseContractError)
}

describe('AI expense contract', () => {
  it('parses and trims a valid request and ready result', () => {
    expect(parseAiExpenseRequest({ ...request, text: `  ${request.text}  ` })).toEqual(request)
    expect(parseAiExpenseResult({
      status: 'ready',
      title: 'Dinner',
      amountCents: 3000,
      payerId: 'maya',
      splitMethod: 'equal',
      participantIds: ['me', 'maya'],
      exactSharesCents: [],
    })).toMatchObject({ status: 'ready', title: 'Dinner' })
    expect(parseAiExpenseResult({ status: 'needs_clarification', question: 'Who paid?' }))
      .toEqual({ status: 'needs_clarification', question: 'Who paid?' })
    expect(parseAiExpenseRequest({
      ...request,
      clarification: { question: '  Who paid? ', answer: ' Maya paid. ' },
    }).clarification).toEqual({ question: 'Who paid?', answer: 'Maya paid.' })
  })

  it.each([
    null,
    { ...request, text: 'x' },
    { ...request, text: 'x'.repeat(AI_EXPENSE_TEXT_MAX_LENGTH + 1) },
    { ...request, locale: 'fr' },
    { ...request, currency: 'BTC' },
    { ...request, members: [] },
    { ...request, members: Array.from({ length: AI_EXPENSE_MAX_MEMBERS + 1 }, (_, index) => ({ id: `m${index}`, name: `M ${index}` })) },
    { ...request, members: [{ id: 'me', name: 'Alex' }, { id: 'me', name: 'Other Alex' }] },
    { ...request, members: [{ id: '', name: 'Alex' }] },
    { ...request, members: [{ id: 'me', name: '' }] },
    { ...request, clarification: { question: '', answer: 'Maya' } },
    { ...request, clarification: { question: 'x'.repeat(AI_EXPENSE_CLARIFICATION_MAX_LENGTH + 1), answer: 'Maya' } },
    { ...request, clarification: { question: 'Who paid?', answer: 'x'.repeat(AI_EXPENSE_ANSWER_MAX_LENGTH + 1) } },
  ])('rejects an invalid request: %j', invalidRequest => {
    expectContractError(() => parseAiExpenseRequest(invalidRequest))
  })

  it.each([
    null,
    { status: 'ready' },
    { status: 'needs_clarification', question: '' },
    { status: 'needs_clarification', question: 'x'.repeat(241) },
  ])('rejects an invalid public result: %j', invalidResult => {
    expectContractError(() => parseAiExpenseResult(invalidResult))
  })

  it('normalizes equal and exact drafts', () => {
    expect(normalizeAiExpenseModelOutput(equalOutput, request)).toEqual({
      status: 'ready',
      title: 'Dinner',
      amountCents: 3000,
      payerId: 'maya',
      splitMethod: 'equal',
      participantIds: ['me', 'maya'],
      exactSharesCents: [],
    })
    expect(normalizeAiExpenseModelOutput({
      ...equalOutput,
      splitMethod: 'exact',
      participantIds: ['maya', 'me'],
      exactSharesCents: [
        { memberId: 'me', amountCents: 1000 },
        { memberId: 'maya', amountCents: 2000 },
      ],
    }, request)).toMatchObject({ status: 'ready', splitMethod: 'exact' })
  })

  it('normalizes a useful clarification and rejects an unusable one', () => {
    expect(normalizeAiExpenseModelOutput({
      ...equalOutput,
      status: 'needs_clarification',
      clarificationQuestion: '  Who paid?  ',
    }, request)).toEqual({ status: 'needs_clarification', question: 'Who paid?' })
    expectContractError(() => normalizeAiExpenseModelOutput({
      ...equalOutput,
      status: 'needs_clarification',
      clarificationQuestion: null,
    }, request))
    expectContractError(() => normalizeAiExpenseModelOutput({
      ...equalOutput,
      status: 'needs_clarification',
      clarificationQuestion: 'x'.repeat(241),
    }, request))
  })

  it.each([
    { title: null },
    { title: ' ' },
    { title: 'x'.repeat(AI_EXPENSE_TITLE_MAX_LENGTH + 1) },
    { amountCents: null },
    { amountCents: 0 },
    { amountCents: AI_EXPENSE_MAX_AMOUNT_CENTS + 1 },
    { payerId: null },
    { payerId: 'unknown' },
    { splitMethod: null },
    { participantIds: [] },
    { participantIds: Array.from({ length: AI_EXPENSE_MAX_MEMBERS + 1 }, (_, index) => `m${index}`) },
    { participantIds: ['me', 'me'] },
    { participantIds: ['unknown'] },
  ] satisfies Array<Partial<AiExpenseModelOutput>>)('rejects unsafe ready draft fields: %j', override => {
    expectContractError(() => normalizeAiExpenseModelOutput({ ...equalOutput, ...override }, request))
  })

  it('rejects shares on an equal split', () => {
    expectContractError(() => normalizeAiExpenseModelOutput({
      ...equalOutput,
      exactSharesCents: [{ memberId: 'me', amountCents: 3000 }],
    }, request))
  })

  it.each([
    {
      participantIds: ['me'],
      exactSharesCents: [
        { memberId: 'me', amountCents: 1000 },
        { memberId: 'me', amountCents: 2000 },
      ],
    },
    {
      participantIds: ['unknown'],
      exactSharesCents: [{ memberId: 'unknown', amountCents: 3000 }],
    },
    {
      participantIds: ['me'],
      exactSharesCents: [{ memberId: 'maya', amountCents: 3000 }],
    },
    {
      participantIds: ['me', 'maya'],
      exactSharesCents: [{ memberId: 'me', amountCents: 3000 }],
    },
    {
      participantIds: ['me'],
      exactSharesCents: [{ memberId: 'me', amountCents: 2999 }],
    },
  ])('rejects inconsistent exact shares: %j', override => {
    expectContractError(() => normalizeAiExpenseModelOutput({
      ...equalOutput,
      splitMethod: 'exact',
      ...override,
    }, request))
  })

  it('rejects a model response outside the fixed schema', () => {
    expectContractError(() => normalizeAiExpenseModelOutput({ status: 'ready' }, request))
  })
})
