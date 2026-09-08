import { useCallback, useMemo, useRef, useState } from 'react'
import type { AiExpenseClient } from '../aiExpense/aiExpenseApi'
import type { ReceiptClient } from '../receiptSplit/receiptApi'
import { markAiRatingPromptHandled, shouldShowAiRatingPrompt } from './ratingPromptStorage'

// Observe real attempts, independently of analytics availability. The app waits
// for an unobstructed screen before showing the invitation, preserving AI drafts.
export function useAiFeedbackPrompt({ aiExpenseClient, receiptClient, enabled }: {
  aiExpenseClient: Pick<AiExpenseClient, 'parseBatch'> | null
  receiptClient: Pick<ReceiptClient, 'parse'> | null
  enabled: boolean
}) {
  const [pending, setPending] = useState(false)
  const handled = useRef(false)
  const queue = useCallback(() => {
    if (!handled.current && shouldShowAiRatingPrompt()) setPending(true)
  }, [])
  const dismiss = useCallback(() => {
    handled.current = true
    markAiRatingPromptHandled()
    setPending(false)
  }, [])

  const observedAiClient = useMemo(() => {
    if (!enabled || !aiExpenseClient) return aiExpenseClient
    return {
      async parseBatch(request: Parameters<AiExpenseClient['parseBatch']>[0]) {
        try {
          return await aiExpenseClient.parseBatch(request)
        } finally {
          queue()
        }
      },
    }
  }, [aiExpenseClient, enabled, queue])
  const observedReceiptClient = useMemo(() => {
    if (!enabled || !receiptClient) return receiptClient
    return {
      async parse(request: Parameters<ReceiptClient['parse']>[0]) {
        try {
          return await receiptClient.parse(request)
        } finally {
          queue()
        }
      },
    }
  }, [enabled, queue, receiptClient])

  return { aiExpenseClient: observedAiClient, receiptClient: observedReceiptClient, pending, dismiss }
}
