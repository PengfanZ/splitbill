import '@supabase/functions-js/edge-runtime.d.ts'
import { receiptRequestId, RECEIPT_REQUEST_ID_HEADER } from '../../../src/features/receiptSplit/receiptDiagnostics.ts'
import { withSupabase } from '@supabase/server'
import {
  handleParseReceiptRequest,
  RECEIPT_CORS_HEADERS,
} from '../../../src/features/receiptSplit/parseReceiptHandler.ts'

type ReceiptDatabase = {
  public: {
    Tables: Record<string, never>
    Views: Record<string, never>
    Functions: {
      consume_ai_expense_quota_v2: {
        Args: { p_identifier: string; p_input_mode: string }
        Returns: string
      }
    }
  }
}

const handler = withSupabase<ReceiptDatabase>({
    auth: 'publishable',
    cors: RECEIPT_CORS_HEADERS,
  }, async (request, context) => (
    handleParseReceiptRequest(request, {
      getEnvironment: name => Deno.env.get(name),
      reportDiagnostic: diagnostic => console.info(JSON.stringify({ type: 'receipt_diagnostic', ...diagnostic })),
      consumeQuota: async identifier => {
        const { data, error } = await context.supabaseAdmin.rpc('consume_ai_expense_quota_v2', {
          p_identifier: identifier,
          p_input_mode: 'receipt',
        })
        if (error) throw error
        if (data === 'allowed') return 'allowed'
        if (data === 'client_limit') return 'client-limit'
        if (data === 'global_limit') return 'global-limit'
        throw new Error('AI quota service returned an invalid result.')
      },
    })
  ))

export default {
  async fetch(request: Request) {
    if (request.method === 'OPTIONS') return handler(request)
    const requestId = receiptRequestId(request.headers.get(RECEIPT_REQUEST_ID_HEADER))
    const headers = new Headers(request.headers)
    headers.set(RECEIPT_REQUEST_ID_HEADER, requestId)
    const started = performance.now()
    console.info(JSON.stringify({ type: 'receipt_request', requestId, event: 'received' }))
    try {
      const response = await handler(new Request(request, { headers }))
      console.info(JSON.stringify({ type: 'receipt_request', requestId, event: 'responded', status: response.status, elapsedMs: Math.round(performance.now() - started) }))
      return response
    } catch {
      console.error(JSON.stringify({ type: 'receipt_request', requestId, event: 'middleware_failed', elapsedMs: Math.round(performance.now() - started) }))
      return Response.json({ code: 'internal_error', message: 'Receipt splitting is temporarily unavailable.' }, { status: 500, headers: { ...RECEIPT_CORS_HEADERS, [RECEIPT_REQUEST_ID_HEADER]: requestId, 'cache-control': 'no-store' } })
    }
  },
}
