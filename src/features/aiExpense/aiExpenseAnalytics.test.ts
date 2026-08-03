import { describe, expect, it, vi } from 'vitest'
import type { AnalyticsClient } from '../../analytics'
import type { AiExpenseRequest } from './aiExpenseContract'
import { withAiExpenseAnalytics } from './aiExpenseAnalytics'

const textRequest: AiExpenseRequest = {
  inputMode: 'text',
  text: 'Maya paid $20 for lunch',
  locale: 'en',
  currency: 'USD',
  members: [{ id: 'maya', name: 'Maya' }],
  viewerMemberId: 'maya',
}

const readyBatch = {
  status: 'ready_batch' as const,
  drafts: [{
    status: 'ready' as const,
    title: 'Lunch',
    amountCents: 2_000,
    payerId: 'maya',
    splitMethod: 'equal' as const,
    participantIds: ['maya'],
    exactSharesCents: [],
  }],
}

function analyticsClient(track = vi.fn()): AnalyticsClient {
  return { track }
}

describe('AI expense analytics', () => {
  it('tracks a successful text request without expense content', async () => {
    const parseBatch = vi.fn().mockResolvedValue(readyBatch)
    const analytics = analyticsClient()
    const client = withAiExpenseAnalytics({ parseBatch }, analytics, 'local', 'en')!

    await expect(client.parseBatch(textRequest)).resolves.toEqual(readyBatch)

    expect(parseBatch).toHaveBeenCalledWith(textRequest)
    expect(analytics.track).toHaveBeenNthCalledWith(1, 'ai_text_requested', 'local', 'en')
    expect(analytics.track).toHaveBeenNthCalledWith(2, 'ai_text_ready', 'local', 'en')
  })

  it('tracks a voice clarification on the active Live surface', async () => {
    const result = { status: 'needs_clarification' as const, question: 'Who paid?' }
    const parseBatch = vi.fn().mockResolvedValue(result)
    const analytics = analyticsClient()
    const client = withAiExpenseAnalytics({ parseBatch }, analytics, 'live', 'zh-CN')!
    const voiceRequest: AiExpenseRequest = {
      inputMode: 'voice',
      audio: { data: 'A'.repeat(64), format: 'wav', durationSeconds: 1 },
      locale: 'zh-CN',
      currency: 'CNY',
      members: [{ id: 'maya', name: 'Maya' }],
    }

    await expect(client.parseBatch(voiceRequest)).resolves.toEqual(result)
    expect(analytics.track).toHaveBeenNthCalledWith(1, 'ai_voice_requested', 'live', 'zh-CN')
    expect(analytics.track).toHaveBeenNthCalledWith(2, 'ai_voice_clarification', 'live', 'zh-CN')
  })

  it('tracks failure and preserves the original error', async () => {
    const error = new Error('provider unavailable')
    const parseBatch = vi.fn().mockRejectedValue(error)
    const analytics = analyticsClient()
    const client = withAiExpenseAnalytics({ parseBatch }, analytics, 'local', 'en')!

    await expect(client.parseBatch(textRequest)).rejects.toBe(error)
    expect(analytics.track).toHaveBeenNthCalledWith(1, 'ai_text_requested', 'local', 'en')
    expect(analytics.track).toHaveBeenNthCalledWith(2, 'ai_text_failed', 'local', 'en')
  })

  it('does not let analytics failures interrupt AI entry', async () => {
    const parseBatch = vi.fn().mockResolvedValue(readyBatch)
    const analytics = analyticsClient(vi.fn(() => { throw new Error('analytics unavailable') }))
    const client = withAiExpenseAnalytics({ parseBatch }, analytics, 'local', 'en')!

    await expect(client.parseBatch(textRequest)).resolves.toEqual(readyBatch)
    expect(analytics.track).toHaveBeenCalledTimes(2)
  })

  it('preserves disabled or unmonitored clients without a wrapper', () => {
    const client = { parseBatch: vi.fn() }
    expect(withAiExpenseAnalytics(null, analyticsClient(), 'local', 'en')).toBeNull()
    expect(withAiExpenseAnalytics(client, null, 'local', 'en')).toBe(client)
  })
})
