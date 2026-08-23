import { createServer } from 'node:http'
import { AI_EXPENSE_CORS_HEADERS } from '../src/features/aiExpense/parseExpenseHandler.ts'
import { RECEIPT_CORS_HEADERS } from '../src/features/receiptSplit/parseReceiptHandler.ts'

const host = '127.0.0.1'
const port = 4184
const corsHeaders = {
  ...AI_EXPENSE_CORS_HEADERS,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const allowedRequestHeaders = new Set(
  `${AI_EXPENSE_CORS_HEADERS['Access-Control-Allow-Headers']},${RECEIPT_CORS_HEADERS['Access-Control-Allow-Headers']}`
    .split(',')
    .map(header => header.trim().toLowerCase()),
)

const server = createServer((request, response) => {
  if (request.method === 'OPTIONS') {
    const isAiExpensePreflight = request.url === '/functions/v1/parse-expense'
      || request.url === '/functions/v1/parse-receipt'
    const requestedHeaders = (request.headers['access-control-request-headers'] ?? '')
      .split(',')
      .map(header => header.trim().toLowerCase())
      .filter(Boolean)
    if (isAiExpensePreflight
      && !requestedHeaders.every(header => allowedRequestHeaders.has(header))) {
      console.error(`Rejected CORS preflight headers: ${requestedHeaders.join(', ')}`)
      response.writeHead(400, corsHeaders)
      response.end()
      return
    }
    response.writeHead(204, corsHeaders)
    response.end()
    return
  }

  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'text/plain' })
    response.end('ok')
    return
  }

  if (request.url === '/rest/v1/rpc/record_analytics_event') {
    response.writeHead(204, corsHeaders)
    response.end()
    return
  }

  const isExpenseRequest = request.url === '/functions/v1/parse-expense'
  const isReceiptRequest = request.url === '/functions/v1/parse-receipt'
  if (request.method !== 'POST' || (!isExpenseRequest && !isReceiptRequest)) {
    response.writeHead(404, corsHeaders)
    response.end()
    return
  }

  const chunks: Buffer[] = []
  request.on('data', chunk => chunks.push(Buffer.from(chunk)))
  request.on('end', () => {
    if (isReceiptRequest) {
      response.writeHead(200, {
        ...corsHeaders,
        'content-type': 'application/json',
      })
      response.end(JSON.stringify({
        model: 'google/gemma-4-26b-a4b-it:free',
        result: {
          version: 1,
          merchant: 'Bao Button',
          currency: 'USD',
          purchasedAt: '2026-08-22',
          items: [
            {
              id: 'item-1',
              name: 'Ramen',
              quantity: 1,
              unitPriceCents: 1800,
              totalCents: 2000,
              details: [{ kind: 'add-on', label: 'Egg', amountCents: 200 }],
              sourceLines: ['Ramen 18.00', 'Egg 2.00'],
              confidence: 'high',
            },
            {
              id: 'item-2',
              name: 'Bao',
              quantity: 2,
              unitPriceCents: 600,
              totalCents: 1200,
              details: [],
              sourceLines: ['2 Bao 12.00'],
              confidence: 'high',
            },
          ],
          charges: [{
            id: 'charge-1',
            type: 'tax',
            label: 'Tax 8%',
            amountCents: 256,
            rateBasisPoints: 800,
            confidence: 'high',
          }],
          subtotalCents: 3200,
          totalCents: 3456,
          unresolvedLines: [],
        },
      }))
      return
    }
    const body = JSON.parse(Buffer.concat(chunks).toString()) as {
      inputMode: 'text' | 'voice'
      members: Array<{ id: string }>
      responseMode?: 'batch'
      text?: string
    }
    const payerId = body.members[1]?.id ?? body.members[0].id
    const result = body.inputMode === 'voice'
      ? {
          status: 'ready',
          title: 'Voice CORS dinner',
          amountCents: 4_200,
          payerId,
          splitMethod: 'equal',
          participantIds: body.members.map(member => member.id),
          exactSharesCents: [],
        }
      : {
          status: 'ready',
          title: 'CORS dinner',
          amountCents: 2_000,
          payerId,
          splitMethod: 'equal',
          participantIds: body.members.map(member => member.id),
          exactSharesCents: [],
        }

    response.writeHead(200, {
      ...corsHeaders,
      'content-type': 'application/json',
    })
    const drafts = [result]
    if (body.inputMode === 'text' && body.text?.toLowerCase().includes('groceries')) {
      drafts.push({
        status: 'ready',
        title: 'Groceries',
        amountCents: 4_600,
        payerId,
        splitMethod: 'equal',
        participantIds: body.members.map(member => member.id),
        exactSharesCents: [],
      })
    }
    response.end(JSON.stringify({
      result: body.responseMode === 'batch'
        ? { status: 'ready_batch', drafts }
        : result,
    }))
  })
})

server.listen(port, host, () => {
  console.log(`AI preview test server listening on http://${host}:${port}`)
})

const close = () => server.close(() => process.exit(0))
process.on('SIGINT', close)
process.on('SIGTERM', close)
