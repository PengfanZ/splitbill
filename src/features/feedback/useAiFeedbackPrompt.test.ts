import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AiExpenseRequest, AiExpenseBatchResult } from '../aiExpense/aiExpenseContract'
import type { ParseReceiptRequest } from '../receiptSplit/receiptContract'
import { markAiRatingPromptHandled } from './ratingPromptStorage'
import { useAiFeedbackPrompt } from './useAiFeedbackPrompt'

const textRequest = {
  inputMode: 'text', text: 'I paid $20 for noodles, split with Maya', locale: 'en', currency: 'USD',
  members: [{ id: 'me', name: 'Tester' }, { id: 'maya', name: 'Maya' }], viewerMemberId: 'me',
} as const
const receiptRequest: ParseReceiptRequest = { image: { dataUrl: 'test-image', width: 1, height: 1 }, locale: 'en', currency: 'USD' }

describe('useAiFeedbackPrompt', () => {
  it('leaves absent or disabled clients untouched and does not treat browsing tabs as use', () => {
    const aiExpenseClient = { parseBatch: vi.fn() }
    const receiptClient = { parse: vi.fn() }
    const disabled = renderHook(() => useAiFeedbackPrompt({ enabled: false, aiExpenseClient, receiptClient }))
    expect(disabled.result.current.aiExpenseClient).toBe(aiExpenseClient)
    expect(disabled.result.current.receiptClient).toBe(receiptClient)
    expect(disabled.result.current.pending).toBe(false)
    const absent = renderHook(() => useAiFeedbackPrompt({ enabled: true, aiExpenseClient: null, receiptClient: null }))
    expect(absent.result.current.aiExpenseClient).toBeNull()
    expect(absent.result.current.receiptClient).toBeNull()
  })

  it.each(['text', 'voice'] as const)('queues after a %s attempt settles, never while it is loading', async inputMode => {
    let resolve!: (value: AiExpenseBatchResult) => void
    const response = { status: 'needs_clarification', question: 'Who paid?' } as const
    const parseBatch = vi.fn(() => new Promise<AiExpenseBatchResult>(done => { resolve = done }))
    const { result } = renderHook(() => useAiFeedbackPrompt({ enabled: true, aiExpenseClient: { parseBatch }, receiptClient: null }))
    let promise!: Promise<unknown>
    const request: AiExpenseRequest = inputMode === 'text'
      ? { ...textRequest, members: [...textRequest.members] }
      : { inputMode, audio: { data: 'A'.repeat(64), format: 'wav', durationSeconds: 1 }, locale: 'en', currency: 'USD', members: [...textRequest.members], viewerMemberId: 'me' }
    act(() => { promise = result.current.aiExpenseClient!.parseBatch(request) })
    expect(result.current.pending).toBe(false)
    await act(async () => { resolve(response); expect(await promise).toBe(response) })
    expect(result.current.pending).toBe(true)
  })

  it('queues after failures without changing the original error', async () => {
    const error = new Error('provider unavailable')
    const parseBatch = vi.fn().mockRejectedValue(error)
    const parse = vi.fn().mockRejectedValue(error)
    const { result } = renderHook(() => useAiFeedbackPrompt({ enabled: true, aiExpenseClient: { parseBatch }, receiptClient: { parse } }))
    await act(async () => { await expect(result.current.aiExpenseClient!.parseBatch({ ...textRequest, members: [...textRequest.members] })).rejects.toBe(error) })
    expect(result.current.pending).toBe(true)
    await act(async () => { await expect(result.current.receiptClient!.parse(receiptRequest)).rejects.toBe(error) })
    expect(result.current.pending).toBe(true)
  })

  it('shares one prompt across receipt, text and voice and remembers dismissal after remount', async () => {
    const receipt = { items: [] }
    const clients = { enabled: true, aiExpenseClient: { parseBatch: vi.fn().mockResolvedValue({ status: 'ready_batch', drafts: [] }) }, receiptClient: { parse: vi.fn().mockResolvedValue(receipt) } }
    const first = renderHook(() => useAiFeedbackPrompt(clients))
    await act(async () => { expect(await first.result.current.receiptClient!.parse(receiptRequest)).toBe(receipt) })
    expect(first.result.current.pending).toBe(true)
    act(() => first.result.current.dismiss())
    await act(async () => { await first.result.current.aiExpenseClient!.parseBatch({ ...textRequest, members: [...textRequest.members] }) })
    expect(first.result.current.pending).toBe(false)
    first.unmount()
    const second = renderHook(() => useAiFeedbackPrompt(clients))
    await act(async () => { await second.result.current.receiptClient!.parse(receiptRequest) })
    expect(second.result.current.pending).toBe(false)
  })

  it('respects a handled marker written by another tab before an attempt ends', async () => {
    const { result } = renderHook(() => useAiFeedbackPrompt({ enabled: true, aiExpenseClient: null, receiptClient: { parse: vi.fn().mockResolvedValue({}) } }))
    markAiRatingPromptHandled()
    await act(async () => { await result.current.receiptClient!.parse(receiptRequest) })
    expect(result.current.pending).toBe(false)
  })

  it('does not repeat within the session when localStorage is unavailable', async () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    try {
      const { result } = renderHook(() => useAiFeedbackPrompt({ enabled: true, aiExpenseClient: null, receiptClient: { parse: vi.fn().mockResolvedValue({}) } }))
      await act(async () => { await result.current.receiptClient!.parse(receiptRequest) })
      expect(result.current.pending).toBe(true)
      act(() => result.current.dismiss())
      await act(async () => { await result.current.receiptClient!.parse(receiptRequest) })
      expect(result.current.pending).toBe(false)
    } finally {
      vi.restoreAllMocks()
    }
  })
})
