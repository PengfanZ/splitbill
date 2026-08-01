import '@supabase/functions-js/edge-runtime.d.ts'
import { withSupabase } from '@supabase/server'
import { handleParseExpenseRequest } from '../../../src/features/aiExpense/parseExpenseHandler.ts'

export default {
  fetch: withSupabase({ auth: 'publishable' }, async (request, context) => (
    handleParseExpenseRequest(request, {
      getEnvironment: name => Deno.env.get(name),
      consumeQuota: async identifier => {
        const { data, error } = await context.supabaseAdmin.rpc('consume_ai_expense_quota', {
          p_identifier: identifier,
        })
        if (error) throw error
        return data === true
      },
      reportProviderFailure: failure => console.warn('AI provider request failed', failure),
    })
  )),
}
