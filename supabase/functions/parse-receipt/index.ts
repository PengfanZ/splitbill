import '@supabase/functions-js/edge-runtime.d.ts'
import { withSupabase } from '@supabase/server'
import {
  handleParseReceiptRequest,
  RECEIPT_CORS_HEADERS,
} from '../../../src/features/receiptSplit/parseReceiptHandler.ts'

export default {
  fetch: withSupabase({
    auth: 'publishable',
    cors: RECEIPT_CORS_HEADERS,
  }, async (request, context) => (
    handleParseReceiptRequest(request, {
      getEnvironment: name => Deno.env.get(name),
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
      reportProviderFailure: failure => console.warn('Receipt AI provider request failed', failure),
      reportModelOutputFailure: failure => console.warn('Receipt AI model output rejected', failure),
    })
  )),
}
