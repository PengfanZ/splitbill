import { createServer } from 'node:http'
import { AI_EXPENSE_CORS_HEADERS } from '../src/features/aiExpense/parseExpenseHandler.ts'

const host = '127.0.0.1'
const port = 4184
const corsHeaders = {
  ...AI_EXPENSE_CORS_HEADERS,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const allowedRequestHeaders = new Set(
  AI_EXPENSE_CORS_HEADERS['Access-Control-Allow-Headers']
    .split(',')
    .map(header => header.trim().toLowerCase()),
)
let validatedPreflights = 0

const server = createServer((request, response) => {
  if (request.method === 'OPTIONS') {
    const isAiExpensePreflight = request.url === '/functions/v1/parse-expense'
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
    if (isAiExpensePreflight) validatedPreflights += 1
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

  if (request.method !== 'POST' || request.url !== '/functions/v1/parse-expense') {
    response.writeHead(404, corsHeaders)
    response.end()
    return
  }

  if (validatedPreflights === 0) {
    console.error('Rejected AI POST without a validated CORS preflight.')
    response.writeHead(428, {
      ...corsHeaders,
      'content-type': 'application/json',
    })
    response.end(JSON.stringify({ code: 'cors_preflight_required' }))
    return
  }
  validatedPreflights -= 1

  const chunks: Buffer[] = []
  request.on('data', chunk => chunks.push(Buffer.from(chunk)))
  request.on('end', () => {
    const body = JSON.parse(Buffer.concat(chunks).toString()) as {
      inputMode: 'text' | 'voice'
      members: Array<{ id: string }>
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
    response.end(JSON.stringify({ result }))
  })
})

server.listen(port, host, () => {
  console.log(`AI preview test server listening on http://${host}:${port}`)
})

const close = () => server.close(() => process.exit(0))
process.on('SIGINT', close)
process.on('SIGTERM', close)
