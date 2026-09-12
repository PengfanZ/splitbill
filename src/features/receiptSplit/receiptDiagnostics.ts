import type { ReceiptModelOutputIssue } from './receiptPrompt.ts'

export const RECEIPT_REQUEST_ID_HEADER = 'x-tally-request-id'
const REQUEST_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i

export function receiptRequestId(value: string | null) {
  return value && REQUEST_ID_PATTERN.test(value) ? value.toLowerCase() : crypto.randomUUID()
}

type ReceiptStage = 'request' | 'upload' | 'quota' | 'provider' | 'provider_body' | 'validation'
export type ReceiptDiagnostic = {
  requestId: string
  event: 'stage_started' | 'stage_finished' | 'upload_validated' | 'provider_response' | 'completed' | 'failure'
  stage: ReceiptStage
  elapsedMs: number
  stageMs: number
  attempt?: number
  status?: number
  reason?: string
  requestBytes?: number
  model?: string
  issues?: ReceiptModelOutputIssue[]
  providerRequestId?: string
  finishReason?: string
}

// Allowlisted metadata only: never log response bodies, receipt text, or money.
export function receiptProviderMetadata(value: unknown): Pick<ReceiptDiagnostic, 'providerRequestId' | 'finishReason'> {
  if (typeof value !== 'object' || value === null) return {}
  const payload = value as Record<string, unknown>
  const metadata: Pick<ReceiptDiagnostic, 'providerRequestId' | 'finishReason'> = {}
  if (typeof payload.id === 'string' && /^gen-[a-z0-9-]{1,120}$/i.test(payload.id)) {
    metadata.providerRequestId = payload.id
  }
  const choice: unknown = Array.isArray(payload.choices) ? payload.choices[0] : null
  if (typeof choice === 'object' && choice !== null && 'finish_reason' in choice
    && typeof choice.finish_reason === 'string'
    && ['stop', 'length', 'content_filter', 'tool_calls', 'error'].includes(choice.finish_reason)) {
    metadata.finishReason = choice.finish_reason
  }
  return metadata
}

export function createReceiptTrace(
  requestId: string,
  report?: (diagnostic: ReceiptDiagnostic) => void,
  now: () => number = () => performance.now(),
) {
  const started = now()
  let stageStarted = started
  let stage: ReceiptStage = 'request'
  const emit = (event: ReceiptDiagnostic['event'], details: Partial<Pick<ReceiptDiagnostic, 'attempt' | 'status' | 'reason' | 'requestBytes' | 'model' | 'issues' | 'providerRequestId' | 'finishReason'>> = {}) => {
    try {
      const safeDetails = { ...details }
      if (safeDetails.model && !/^[a-z0-9/.:_-]{1,150}$/i.test(safeDetails.model)) safeDetails.model = 'unknown'
      report?.({ requestId, event, stage, elapsedMs: Math.round(now() - started), stageMs: Math.round(now() - stageStarted), ...safeDetails })
    } catch {
      // Diagnostics must never affect receipt parsing.
    }
  }
  emit('stage_started')
  return {
    stage(next: ReceiptStage, details: Parameters<typeof emit>[1] = {}) {
      emit('stage_finished')
      stage = next
      stageStarted = now()
      emit('stage_started', details)
    },
    emit,
  }
}

export type ReceiptClientDiagnostic = {
  requestId: string
  outcome: 'success' | 'timeout' | 'network' | 'invalid-input' | 'rate-limit' | 'credits' | 'model-unavailable' | 'invalid-response' | 'unavailable' | 'configuration'
  elapsedMs: number
  status: number | null
}

export function createReceiptDiagnosticReporter(baseUrl: string, key: string, fetcher: typeof fetch) {
  return (diagnostic: ReceiptClientDiagnostic) => {
    try {
      void fetcher(`${baseUrl}/rest/v1/rpc/record_receipt_client_diagnostic`, {
        method: 'POST',
        headers: { apikey: key, 'content-type': 'application/json' },
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
        keepalive: true,
        signal: AbortSignal.timeout(5000),
        body: JSON.stringify({
          p_request_id: diagnostic.requestId,
          p_outcome: diagnostic.outcome,
          p_elapsed_ms: Math.min(3600000, Math.max(0, Math.round(diagnostic.elapsedMs))),
          p_status: diagnostic.status,
        }),
      }).catch(() => undefined)
    } catch {
      // This is best-effort telemetry, never a dependency of expense entry.
    }
  }
}
