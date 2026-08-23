import { describe, expect, it, vi } from 'vitest'
import type { AnalyticsClient } from '../../analytics'
import { receiptDraftFixture } from './receiptContract.test'
import { trackReceiptConfirmed, withReceiptAnalytics } from './receiptAnalytics'

const request = {
  image: { dataUrl: 'data:image/jpeg;base64,QQ==', width: 1, height: 1 },
  locale: 'en' as const,
  currency: 'USD' as const,
}

function analytics(track = vi.fn()): AnalyticsClient {
  return { track }
}

describe('receipt analytics', () => {
  it('tracks a successful receipt parse without receipt content', async () => {
    const parse = vi.fn().mockResolvedValue(receiptDraftFixture)
    const clientAnalytics = analytics()
    const client = withReceiptAnalytics({ parse }, clientAnalytics, 'local', 'en')!
    await expect(client.parse(request)).resolves.toEqual(receiptDraftFixture)
    expect(clientAnalytics.track).toHaveBeenNthCalledWith(1, 'ai_receipt_requested', 'local', 'en')
    expect(clientAnalytics.track).toHaveBeenNthCalledWith(2, 'ai_receipt_ready', 'local', 'en')
  })

  it('tracks failure, confirmation, and preserves analytics isolation', async () => {
    const error = new Error('failed')
    const clientAnalytics = analytics()
    const client = withReceiptAnalytics({ parse: vi.fn().mockRejectedValue(error) }, clientAnalytics, 'live', 'zh-CN')!
    await expect(client.parse({ ...request, locale: 'zh-CN' })).rejects.toBe(error)
    expect(clientAnalytics.track).toHaveBeenNthCalledWith(2, 'ai_receipt_failed', 'live', 'zh-CN')
    trackReceiptConfirmed(clientAnalytics, 'live', 'zh-CN')
    expect(clientAnalytics.track).toHaveBeenLastCalledWith('ai_receipt_confirmed', 'live', 'zh-CN')

    const throwingAnalytics = analytics(vi.fn(() => { throw new Error('analytics') }))
    const safeClient = withReceiptAnalytics({ parse: vi.fn().mockResolvedValue(receiptDraftFixture) }, throwingAnalytics, 'local', 'en')!
    await expect(safeClient.parse(request)).resolves.toEqual(receiptDraftFixture)
    expect(() => trackReceiptConfirmed(throwingAnalytics, 'local', 'en')).not.toThrow()
  })

  it('preserves unmonitored clients and ignores disabled confirmation analytics', () => {
    const client = { parse: vi.fn() }
    expect(withReceiptAnalytics(null, analytics(), 'local', 'en')).toBeNull()
    expect(withReceiptAnalytics(client, null, 'local', 'en')).toBe(client)
    expect(() => trackReceiptConfirmed(null, 'local', 'en')).not.toThrow()
  })
})
