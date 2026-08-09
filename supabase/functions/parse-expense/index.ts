import '@supabase/functions-js/edge-runtime.d.ts'
import { withSupabase } from '@supabase/server'
import {
  AI_EXPENSE_CORS_HEADERS,
  handleParseExpenseRequest,
} from '../../../src/features/aiExpense/parseExpenseHandler.ts'

export default {
  fetch: withSupabase({
    auth: 'publishable',
    cors: AI_EXPENSE_CORS_HEADERS,
  }, async (request, context) => (
    handleParseExpenseRequest(request, {
      getEnvironment: name => Deno.env.get(name),
      consumeQuota: async (identifier, inputMode) => {
        const { data, error } = await context.supabaseAdmin.rpc('consume_ai_expense_quota_v2', {
          p_identifier: identifier,
          p_input_mode: inputMode,
        })
        if (error) throw error
        if (data === 'allowed') return 'allowed'
        if (data === 'client_limit') return 'client-limit'
        if (data === 'global_limit') return 'global-limit'
        throw new Error('AI quota service returned an invalid result.')
      },
      reportProviderFailure: failure => console.warn('AI provider request failed', failure),
    })
  )),
}
