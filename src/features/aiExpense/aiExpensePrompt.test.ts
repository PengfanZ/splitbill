import { describe, expect, it } from 'vitest'
import type { AiExpenseRequest } from './aiExpenseContract'
import { AiExpenseContractError } from './aiExpenseContract'
import {
  AI_EXPENSE_JSON_SCHEMA,
  buildOpenRouterRequest,
  DEFAULT_OPENROUTER_MODEL,
  parseOpenRouterModelOutput,
} from './aiExpensePrompt'

const request: AiExpenseRequest = {
  text: 'Maya paid $20 for lunch',
  locale: 'en',
  currency: 'USD',
  members: [{ id: 'maya', name: 'Maya' }],
}

const output = {
  status: 'ready',
  title: 'Lunch',
  amountCents: 2000,
  payerId: 'maya',
  splitMethod: 'equal',
  participantIds: ['maya'],
  exactSharesCents: [],
  clarificationQuestion: null,
}

describe('OpenRouter expense prompt', () => {
  it('builds a strict, privacy-conscious request with a pinned free default', () => {
    const built = buildOpenRouterRequest(request)
    expect(built.model).toBe(DEFAULT_OPENROUTER_MODEL)
    expect(built.response_format.json_schema).toMatchObject({ strict: true, schema: AI_EXPENSE_JSON_SCHEMA })
    expect(built.provider).toEqual({ allow_fallbacks: false, data_collection: 'deny', require_parameters: true })
    expect(built).not.toHaveProperty('reasoning')
    expect(built.max_tokens).toBe(700)
    expect(built.messages[0].content).toContain('untrusted data')
    expect(JSON.parse(built.messages[1].content)).toEqual({
      activityCurrency: 'USD',
      locale: 'en',
      members: request.members,
      expenseDescription: request.text,
    })
    expect(buildOpenRouterRequest(request, 'google/gemma-free').model).toBe('google/gemma-free')
  })

  it('parses a structured model response', () => {
    expect(parseOpenRouterModelOutput({
      choices: [{ message: { content: JSON.stringify(output) } }],
    })).toEqual(output)
  })

  it.each([
    null,
    {},
    { choices: [] },
    { choices: [null] },
    { choices: [{ message: null }] },
    { choices: [{ message: { content: 42 } }] },
    { choices: [{ message: { content: '{' } }] },
    { choices: [{ message: { content: JSON.stringify({ status: 'ready' }) } }] },
  ])('rejects an unsafe provider response: %j', response => {
    expect(() => parseOpenRouterModelOutput(response)).toThrow(AiExpenseContractError)
  })
})
