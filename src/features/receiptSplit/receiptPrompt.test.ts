import { describe, expect, it } from 'vitest'
import { receiptDraftFixture } from './receiptContract.test'
import {
  buildReceiptOpenRouterRequest,
  DEFAULT_OPENROUTER_RECEIPT_FALLBACK_MODEL,
  DEFAULT_OPENROUTER_RECEIPT_MODEL,
  parseOpenRouterReceiptOutput,
  RECEIPT_JSON_SCHEMA,
  ReceiptModelOutputError,
} from './receiptPrompt'

const request = {
  image: { dataUrl: 'data:image/jpeg;base64,QQ==', width: 1, height: 1 },
  locale: 'en' as const,
  currency: 'USD' as const,
}

describe('receipt OpenRouter prompt', () => {
  it('builds a multimodal JSON request with an explicit locally validated contract', () => {
    const body = buildReceiptOpenRouterRequest(request)
    expect(body.models).toEqual([...new Set([
      DEFAULT_OPENROUTER_RECEIPT_MODEL,
      DEFAULT_OPENROUTER_RECEIPT_FALLBACK_MODEL,
    ])])
    expect(body.messages[1].content[1]).toEqual({ type: 'image_url', image_url: { url: request.image.dataUrl } })
    expect(body.response_format).toEqual({
      type: 'json_schema',
      json_schema: {
        name: 'tally_receipt',
        strict: true,
        schema: RECEIPT_JSON_SCHEMA,
      },
    })
    const promptPart = body.messages[1].content[0]
    expect(typeof promptPart !== 'string' && typeof promptPart.text === 'string'
      ? JSON.parse(promptPart.text).outputSchema
      : null).toBeUndefined()
    expect(body.provider).toMatchObject({ data_collection: 'deny', require_parameters: true, zdr: true })
    expect(JSON.stringify(RECEIPT_JSON_SCHEMA)).not.toMatch(/minLength|maxLength/)
  })

  it('deduplicates and validates requested models', () => {
    expect(buildReceiptOpenRouterRequest(request, ['same', 'same']).models).toEqual(['same'])
    expect(buildReceiptOpenRouterRequest(request, ['primary', 'fallback']).models).toEqual([
      'primary',
      'fallback',
    ])
    expect(() => buildReceiptOpenRouterRequest(request, ['  '])).toThrow('At least one')
    expect(DEFAULT_OPENROUTER_RECEIPT_FALLBACK_MODEL).not.toBe(DEFAULT_OPENROUTER_RECEIPT_MODEL)
  })

  it('parses a structured receipt response', () => {
    expect(parseOpenRouterReceiptOutput({
      choices: [{ message: { content: JSON.stringify(receiptDraftFixture) } }],
    })).toEqual(receiptDraftFixture)
  })

  it('rejects malformed provider response shapes and content', () => {
    expect(() => parseOpenRouterReceiptOutput(null)).toThrow('unexpected')
    expect(() => parseOpenRouterReceiptOutput({ choices: [] })).toThrow('unexpected')
    expect(() => parseOpenRouterReceiptOutput({ choices: [null] })).toThrow('structured')
    expect(() => parseOpenRouterReceiptOutput({ choices: [{ message: { content: 1 } }] })).toThrow('structured')
    expect(() => parseOpenRouterReceiptOutput({ choices: [{ message: { content: '{' } }] })).toThrow('unreadable')
    expect(() => parseOpenRouterReceiptOutput({ choices: [{ message: { content: '{}' } }] })).toThrow()
  })

  it('reports only safe schema issue codes and paths', () => {
    try {
      parseOpenRouterReceiptOutput({
        choices: [{ message: { content: JSON.stringify({
          ...receiptDraftFixture,
          items: [{ ...receiptDraftFixture.items[0], name: '', totalCents: -1 }],
        }) } }],
      })
      throw new Error('Expected receipt validation to fail.')
    } catch (error) {
      expect(error).toBeInstanceOf(ReceiptModelOutputError)
      expect(error).toMatchObject({
        reason: 'schema_validation',
        issues: expect.arrayContaining([
          expect.objectContaining({ path: 'items.[].name' }),
          expect.objectContaining({ path: 'items.[].totalCents' }),
        ]),
      })
      expect(JSON.stringify(error)).not.toContain(receiptDraftFixture.items[0].name)
    }
  })
})
