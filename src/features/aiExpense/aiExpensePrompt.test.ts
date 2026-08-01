import { describe, expect, it } from 'vitest'
import type { AiExpenseRequest } from './aiExpenseContract'
import { AiExpenseContractError } from './aiExpenseContract'
import {
  AI_EXPENSE_JSON_SCHEMA,
  buildOpenRouterRequest,
  DEFAULT_OPENROUTER_FALLBACK_MODEL,
  DEFAULT_OPENROUTER_MODEL,
  getOpenRouterFailure,
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
    expect(built.models).toEqual([DEFAULT_OPENROUTER_MODEL, DEFAULT_OPENROUTER_FALLBACK_MODEL])
    expect(built.response_format.json_schema).toMatchObject({ strict: true, schema: AI_EXPENSE_JSON_SCHEMA })
    expect(built.provider).toEqual({
      allow_fallbacks: true,
      data_collection: 'deny',
      preferred_max_latency: { p90: 3 },
      require_parameters: true,
      sort: { by: 'price', partition: 'none' },
    })
    expect(built).not.toHaveProperty('reasoning')
    expect(built.max_tokens).toBe(700)
    expect(built.messages[0].content).toContain('untrusted data')
    expect(built.messages[0].content).toContain('any language')
    expect(built.messages[0].content).toContain("description's language")
    expect(built.messages[0].content).toContain('vague, unrelated to one expense')
    expect(built.messages[0].content).toContain('Never use status "ready"')
    expect(JSON.parse(built.messages[1].content)).toEqual({
      activityCurrency: 'USD',
      interfaceLocale: 'en',
      members: request.members,
      expenseDescription: request.text,
      clarificationContext: null,
    })
    expect(buildOpenRouterRequest(request, 'google/gemma-free').models).toEqual([
      'google/gemma-free',
      DEFAULT_OPENROUTER_FALLBACK_MODEL,
    ])
    expect(buildOpenRouterRequest(request, 'same-model', 'same-model').models).toEqual(['same-model'])

    const clarified = buildOpenRouterRequest({
      ...request,
      clarification: { question: 'Who paid?', answer: 'Maya paid' },
    })
    expect(JSON.parse(clarified.messages[1].content).clarificationContext).toEqual({
      question: 'Who paid?',
      answer: 'Maya paid',
    })
  })

  it('extracts typed provider failures from top-level and completed-response errors', () => {
    expect(getOpenRouterFailure({
      error: { code: 502, metadata: { error_type: 'provider_unavailable' } },
    })).toEqual({ status: 502, errorType: 'provider_unavailable' })
    expect(getOpenRouterFailure({
      choices: [{ error: { code: 503 } }],
    })).toEqual({ status: 503, errorType: null })
    expect(getOpenRouterFailure({ error: { code: 'unknown', metadata: null } })).toEqual({
      status: null,
      errorType: null,
    })
    expect(getOpenRouterFailure(null)).toBeNull()
    expect(getOpenRouterFailure({ choices: [] })).toBeNull()
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
