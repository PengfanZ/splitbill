import { describe, expect, it, vi } from 'vitest'
import { createReceiptDiagnosticReporter, createReceiptTrace, receiptRequestId } from './receiptDiagnostics'

const id = '12345678-1234-4234-8234-123456789abc'

describe('receipt diagnostics', () => {
  it('accepts a bounded random correlation ID and replaces arbitrary user content', () => {
    expect(receiptRequestId(id.toUpperCase())).toBe(id)
    expect(receiptRequestId('receipt text / api key')).toMatch(/^[a-f0-9-]{36}$/)
    expect(receiptRequestId(null)).not.toBe(receiptRequestId(null))
  })

  it('records stage timing and isolates logging failures without logging freeform model output', () => {
    let now = 0
    const report = vi.fn()
    const trace = createReceiptTrace(id, report, () => now)
    now = 100
    trace.stage('upload')
    now = 28000
    trace.stage('provider', { model: 'secret / user text', attempt: 1 })
    now = 30000
    trace.emit('failure', { reason: 'provider_timeout' })
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ stage: 'upload', event: 'stage_finished', stageMs: 27900 }))
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ stage: 'provider', model: 'unknown' }))
    expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ requestId: id, elapsedMs: 30000, stageMs: 2000, reason: 'provider_timeout' }))
    expect(() => createReceiptTrace(id, () => { throw new Error('logger failed') }).emit('completed')).not.toThrow()
  })

  it('sends only the approved fields and never waits on diagnostic delivery', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('offline'))
    const report = createReceiptDiagnosticReporter('https://example.com', 'public-key', fetcher)
    expect(report({ requestId: id, outcome: 'timeout', elapsedMs: 30000.5, status: null })).toBeUndefined()
    const [url, options] = fetcher.mock.calls[0]
    expect(url).toBe('https://example.com/rest/v1/rpc/record_receipt_client_diagnostic')
    expect(JSON.parse(options.body)).toEqual({ p_request_id: id, p_outcome: 'timeout', p_elapsed_ms: 30001, p_status: null })
    expect(options).toMatchObject({ credentials: 'omit', keepalive: true, referrerPolicy: 'no-referrer' })
    await Promise.resolve()
    expect(() => createReceiptDiagnosticReporter('https://example.com', 'key', () => { throw new Error('blocked') })({ requestId: id, outcome: 'network', elapsedMs: 1, status: null })).not.toThrow()
  })
})
