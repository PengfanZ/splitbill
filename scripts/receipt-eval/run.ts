// Compares receipt models on the rendered fixtures (and optional private photos)
// using the production prompt, schema, and local validation.
//   node scripts/receipt-eval/run.ts [--configs a,b] [--fixtures x,y] [--repeat 2] [--concurrency 4]
// Requires OPENROUTER_API_KEY in the environment or in supabase/functions/.env.local.
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { reconcileReceipt, type ReceiptDraft } from '../../src/features/receiptSplit/receiptContract.ts'
import {
  buildReceiptOpenRouterRequest,
  DEFAULT_OPENROUTER_RECEIPT_FALLBACK_MODEL,
  DEFAULT_OPENROUTER_RECEIPT_MODEL,
  parseOpenRouterReceiptOutput,
  ReceiptModelOutputError,
} from '../../src/features/receiptSplit/receiptPrompt.ts'
import type { ReceiptTruth } from './fixtures.ts'

const ROOT = path.resolve(import.meta.dirname, '../..')
// Synthetic renders, openly licensed Commons photos, and optional private photos.
const IMAGE_DIRS = [
  { directory: path.join(import.meta.dirname, '.cache/images'), source: 'synthetic' },
  { directory: path.join(import.meta.dirname, '.cache/commons'), source: 'real' },
  { directory: path.join(import.meta.dirname, 'private'), source: 'real' },
] as const
const RESULTS_DIR = path.join(import.meta.dirname, '.cache/results')
const REQUEST_TIMEOUT_MS = 60_000
const PRODUCTION_BUDGET_MS = 25_000

type Reasoning = { effort?: 'none' | 'minimal' | 'low' | 'medium' | 'high', enabled?: boolean }
type EvalConfig = { id: string, model: string, fallbackModels?: string[], mode: 'json-schema' | 'json-object', reasoning?: Reasoning }

// Candidates come from OpenRouter's ZDR endpoint catalog: image input plus structured output.
export const CONFIGS: EvalConfig[] = [
  // Exactly what parse-receipt sends on its first attempt: default models, mode, and routing.
  { id: 'production', model: DEFAULT_OPENROUTER_RECEIPT_MODEL, fallbackModels: [DEFAULT_OPENROUTER_RECEIPT_FALLBACK_MODEL], mode: 'json-object' },
  { id: 'g25-lite/schema', model: 'google/gemini-2.5-flash-lite', mode: 'json-schema' },
  { id: 'g25-lite/object', model: 'google/gemini-2.5-flash-lite', mode: 'json-object' },
  { id: 'g25-flash/object', model: 'google/gemini-2.5-flash', mode: 'json-object' },
  { id: 'g25-flash/object-nothink', model: 'google/gemini-2.5-flash', mode: 'json-object', reasoning: { effort: 'none' } },
  { id: 'g31-lite/schema', model: 'google/gemini-3.1-flash-lite', mode: 'json-schema' },
  { id: 'g31-lite/schema-nothink', model: 'google/gemini-3.1-flash-lite', mode: 'json-schema', reasoning: { effort: 'none' } },
  { id: 'g31-lite/object', model: 'google/gemini-3.1-flash-lite', mode: 'json-object' },
  { id: 'g31-lite/object-nothink', model: 'google/gemini-3.1-flash-lite', mode: 'json-object', reasoning: { effort: 'none' } },
  { id: 'g35-lite/schema', model: 'google/gemini-3.5-flash-lite', mode: 'json-schema' },
  { id: 'g35-lite/object', model: 'google/gemini-3.5-flash-lite', mode: 'json-object' },
  { id: 'g37-flash/schema-low', model: 'google/gemini-3.7-flash', mode: 'json-schema', reasoning: { effort: 'low' } },
  { id: 'g37-flash/object', model: 'google/gemini-3.7-flash', mode: 'json-object' },
  { id: 'gemma4-26b/schema', model: 'google/gemma-4-26b-a4b-it', mode: 'json-schema' },
  { id: 'gemma4-31b/schema', model: 'google/gemma-4-31b-it', mode: 'json-schema' },
  { id: 'qwen3-vl-30b/schema', model: 'qwen/qwen3-vl-30b-a3b-instruct', mode: 'json-schema' },
  { id: 'qwen3.5-9b/schema', model: 'qwen/qwen3.5-9b', mode: 'json-schema' },
  { id: 'mistral-small-3.2/schema', model: 'mistralai/mistral-small-3.2-24b-instruct', mode: 'json-schema' },
  { id: 'ministral-14b/schema', model: 'mistralai/ministral-14b-2512', mode: 'json-schema' },
  { id: 'seed-2.0-mini/schema', model: 'bytedance-seed/seed-2.0-mini', mode: 'json-schema' },
  { id: 'gpt-5-nano/schema-minimal', model: 'openai/gpt-5-nano', mode: 'json-schema', reasoning: { effort: 'minimal' } },
  { id: 'gpt-5-nano/object', model: 'openai/gpt-5-nano', mode: 'json-object' },
  { id: 'llama4-scout/schema', model: 'meta-llama/llama-4-scout', mode: 'json-schema' },
]

type ProviderError = { message?: string }
type OpenRouterPayload = {
  model?: string
  provider?: string
  error?: ProviderError
  choices?: { finish_reason?: string, error?: ProviderError }[]
  usage?: { prompt_tokens?: number, completion_tokens?: number, cost?: number, completion_tokens_details?: { reasoning_tokens?: number } }
}

type Sample = {
  id: string
  source: 'synthetic' | 'real'
  dataUrl: string
  width: number
  height: number
  locale: 'en' | 'zh-CN'
  truth: ReceiptTruth
  alternatives: ReceiptTruth[]
}

type Score = {
  valid: boolean
  totalExact: boolean
  subtotalExact: boolean
  reconciles: boolean
  itemCountExact: boolean
  itemRecall: number
  chargesExact: boolean
  currencyExact: boolean
  perfect: boolean
}

type RunResult = {
  config: string
  model: string
  sample: string
  source: Sample['source']
  attempt: number
  status: number | null
  error: string | null
  failureReason: string | null
  finishReason: string | null
  servedModel: string | null
  provider: string | null
  latencyMs: number
  promptTokens: number | null
  completionTokens: number | null
  reasoningTokens: number | null
  costUsd: number | null
  score: Score | null
  // Enough of the draft to diagnose a miss, such as JPY read as whole yen.
  draft: { currency: string | null, totalCents: number, itemCount: number, chargeCount: number } | null
}

// Reads a key without echoing it, so it never appears on screen or in shell history.
function promptHidden(question: string) {
  return new Promise<string>((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error('Set OPENROUTER_API_KEY or add it to supabase/functions/.env.local.'))
      return
    }
    process.stdout.write(question)
    process.stdin.setRawMode(true)
    process.stdin.resume()
    let value = ''
    const onData = (chunk: Buffer) => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\u0003') process.exit(130)
        if (character === '\r' || character === '\n') {
          process.stdin.off('data', onData)
          process.stdin.setRawMode(false)
          process.stdin.pause()
          process.stdout.write('\n')
          resolve(value.trim())
          return
        }
        value = character === '\u007f' ? value.slice(0, -1) : value + character
      }
    }
    process.stdin.on('data', onData)
  })
}

async function apiKey() {
  const envFile = await readFile(path.join(ROOT, 'supabase/functions/.env.local'), 'utf8').catch(() => '')
  const fromFile = /^OPENROUTER_API_KEY=(.+)$/m.exec(envFile)?.[1]?.trim().replace(/^['"]|['"]$/g, '')
  const key = process.env.OPENROUTER_API_KEY?.trim() || fromFile || await promptHidden('OpenRouter key (input hidden): ')
  if (!/^sk-or-[A-Za-z0-9-]{20,}$/.test(key)) {
    throw new Error('That does not look like an OpenRouter key (expected sk-or-…). Nothing was sent.')
  }
  // One cheap authenticated call before spending on hundreds of model requests.
  const check = await fetch('https://openrouter.ai/api/v1/key', { headers: { authorization: `Bearer ${key}` } })
  if (!check.ok) throw new Error(`OpenRouter rejected the key (HTTP ${check.status}). Nothing was spent.`)
  const { data } = await check.json() as { data?: { label?: string, limit?: number | null, usage?: number } }
  const remaining = typeof data?.limit === 'number' ? `$${(data.limit - (data.usage ?? 0)).toFixed(2)} left` : 'no limit set'
  console.log(`Key accepted (${remaining}).`)
  return key
}

async function loadSamples(filter: Set<string> | null): Promise<Sample[]> {
  const samples: Sample[] = []
  for (const { directory, source } of IMAGE_DIRS) {
    const files = await readdir(directory).catch(() => [] as string[])
    for (const file of files.filter(name => /\.jpe?g$/i.test(name)).sort()) {
      const id = file.replace(/\.jpe?g$/i, '')
      if (filter && !filter.has(id)) continue
      const meta = JSON.parse(await readFile(path.join(directory, `${id}.json`), 'utf8'))
      // Photos without verified ground truth are never scored.
      if (!meta.truth) continue
      const image = await readFile(path.join(directory, file))
      samples.push({
        id, source, dataUrl: `data:image/jpeg;base64,${image.toString('base64')}`, width: meta.width, height: meta.height,
        locale: meta.locale, truth: meta.truth, alternatives: meta.alternatives ?? [],
      })
    }
  }
  return samples
}

function multisetRecall(expected: number[], actual: number[]) {
  if (expected.length === 0) return 1
  const remaining = [...actual]
  let matched = 0
  for (const value of expected) {
    const index = remaining.indexOf(value)
    if (index >= 0) {
      matched += 1
      remaining.splice(index, 1)
    }
  }
  return matched / expected.length
}

// Scores against the best-matching accepted reading of the receipt.
export function scoreDraft(draft: ReceiptDraft, truths: ReceiptTruth[]): Score {
  const scores = truths.map(truth => scoreAgainst(draft, truth))
  const rank = (score: Score) => [Number(score.perfect), Number(score.totalExact), score.itemRecall]
  return scores.reduce((best, score) => {
    const [a, b] = [rank(score), rank(best)]
    const index = a.findIndex((value, position) => value !== b[position])
    return index >= 0 && a[index] > b[index] ? score : best
  })
}

function scoreAgainst(draft: ReceiptDraft, truth: ReceiptTruth): Score {
  const itemRecall = multisetRecall(truth.itemTotals, draft.items.map(item => item.totalCents))
  const chargeKey = (charge: { type: string, cents: number }) => `${charge.type}:${charge.cents}`
  // A printed zero-value line (for example "discount 0.00") changes nothing, so it is not scored.
  const expectedCharges = truth.charges.filter(charge => charge.cents !== 0).map(chargeKey).sort()
  const actualCharges = draft.charges.filter(charge => charge.amountCents !== 0)
    .map(charge => chargeKey({ type: charge.type, cents: charge.amountCents })).sort()
  const score = {
    valid: true,
    totalExact: draft.totalCents === truth.totalCents,
    subtotalExact: draft.subtotalCents === truth.subtotalCents,
    reconciles: reconcileReceipt(draft).matches,
    itemCountExact: draft.items.length === truth.itemCount,
    itemRecall,
    chargesExact: JSON.stringify(expectedCharges) === JSON.stringify(actualCharges),
    currencyExact: draft.currency === truth.currency,
  }
  return { ...score, perfect: score.totalExact && score.subtotalExact && score.itemCountExact && itemRecall === 1 && score.chargesExact }
}

async function runOne(config: EvalConfig, sample: Sample, attempt: number, key: string): Promise<RunResult> {
  const request = buildReceiptOpenRouterRequest(
    { image: { dataUrl: sample.dataUrl, width: sample.width, height: sample.height }, locale: sample.locale, currency: sample.truth.currency as 'USD' },
    [config.model, ...(config.fallbackModels ?? [])],
    config.mode,
  )
  const body = { ...request, ...(config.reasoning ? { reasoning: config.reasoning } : {}), usage: { include: true } }
  const base: RunResult = {
    config: config.id, model: config.model, sample: sample.id, source: sample.source, attempt, status: null, error: null, failureReason: null,
    finishReason: null, servedModel: null, provider: null, latencyMs: 0, promptTokens: null, completionTokens: null,
    reasoningTokens: null, costUsd: null, score: null, draft: null,
  }
  const started = performance.now()
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        'http-referer': 'https://pengfanz.github.io/splitbill/',
        'x-title': 'Tally receipt model eval',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    const payload = await response.json() as OpenRouterPayload
    const result: RunResult = {
      ...base,
      status: response.status,
      latencyMs: Math.round(performance.now() - started),
      finishReason: payload.choices?.[0]?.finish_reason ?? null,
      servedModel: payload.model ?? null,
      provider: payload.provider ?? null,
      promptTokens: payload.usage?.prompt_tokens ?? null,
      completionTokens: payload.usage?.completion_tokens ?? null,
      reasoningTokens: payload.usage?.completion_tokens_details?.reasoning_tokens ?? null,
      costUsd: payload.usage?.cost ?? null,
    }
    const embeddedError = payload.error ?? payload.choices?.[0]?.error
    if (!response.ok || embeddedError) {
      return { ...result, error: String(embeddedError?.message ?? `HTTP ${response.status}`).slice(0, 200) }
    }
    try {
      const draft = parseOpenRouterReceiptOutput(payload)
      return {
        ...result,
        score: scoreDraft(draft, [sample.truth, ...sample.alternatives]),
        draft: { currency: draft.currency, totalCents: draft.totalCents, itemCount: draft.items.length, chargeCount: draft.charges.length },
      }
    } catch (error) {
      return { ...result, failureReason: error instanceof ReceiptModelOutputError ? error.reason : 'parse_error' }
    }
  } catch (error) {
    return { ...base, latencyMs: Math.round(performance.now() - started), error: error instanceof Error ? error.name : 'fetch_failed' }
  }
}

function percentile(values: number[], fraction: number) {
  if (values.length === 0) return NaN
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]
}

function percent(count: number, total: number) {
  return total === 0 ? '-' : `${Math.round(100 * count / total)}%`
}

export function summarize(results: RunResult[]) {
  const rows = CONFIGS.filter(config => results.some(result => result.config === config.id)).map(config => {
    const runs = results.filter(result => result.config === config.id)
    const scored = runs.filter(result => result.score)
    const latencies = runs.filter(result => !result.error).map(result => result.latencyMs)
    const costs = runs.map(result => result.costUsd).filter((cost): cost is number => cost !== null)
    return {
      config: config.id,
      runs: runs.length,
      valid: percent(scored.length, runs.length),
      perfect: percent(scored.filter(result => result.score!.perfect).length, runs.length),
      perfectReal: percent(scored.filter(result => result.source === 'real' && result.score!.perfect).length, runs.filter(result => result.source === 'real').length),
      perfectSynth: percent(scored.filter(result => result.source === 'synthetic' && result.score!.perfect).length, runs.filter(result => result.source === 'synthetic').length),
      totalOk: percent(scored.filter(result => result.score!.totalExact).length, runs.length),
      itemRecall: scored.length ? (scored.reduce((sum, result) => sum + result.score!.itemRecall, 0) / scored.length).toFixed(2) : '-',
      chargesOk: percent(scored.filter(result => result.score!.chargesExact).length, runs.length),
      p50s: (percentile(latencies, 0.5) / 1000).toFixed(1),
      p90s: (percentile(latencies, 0.9) / 1000).toFixed(1),
      over25s: runs.filter(result => result.latencyMs > PRODUCTION_BUDGET_MS).length,
      errors: runs.filter(result => result.error).length,
      lengthStops: runs.filter(result => result.finishReason === 'length').length,
      avgOutTok: Math.round(runs.reduce((sum, result) => sum + (result.completionTokens ?? 0), 0) / Math.max(1, runs.length)),
      usdPer1k: costs.length ? (1000 * costs.reduce((a, b) => a + b, 0) / costs.length).toFixed(2) : '-',
    }
  })
  console.table(rows)
  return rows
}

async function main() {
  const { values } = parseArgs({ options: {
    configs: { type: 'string' },
    fixtures: { type: 'string' },
    repeat: { type: 'string', default: '1' },
    concurrency: { type: 'string', default: '4' },
  } })
  const configFilter = values.configs ? new Set(values.configs.split(',')) : null
  const configs = CONFIGS.filter(config => !configFilter || configFilter.has(config.id))
  const samples = await loadSamples(values.fixtures ? new Set(values.fixtures.split(',')) : null)
  if (configs.length === 0 || samples.length === 0) throw new Error('No matching configs or samples. Run render.ts first.')
  const key = await apiKey()
  const jobs = configs.flatMap(config => samples.flatMap(sample => Array.from({ length: Number(values.repeat) }, (_, attempt) => ({ config, sample, attempt }))))
  console.log(`Running ${jobs.length} requests (${configs.length} configs x ${samples.length} samples x ${values.repeat})`)

  const results: RunResult[] = []
  let next = 0
  await Promise.all(Array.from({ length: Number(values.concurrency) }, async () => {
    while (next < jobs.length) {
      const job = jobs[next++]
      const result = await runOne(job.config, job.sample, job.attempt, key)
      results.push(result)
      const outcome = result.error ? `error ${result.error}` : result.score ? (result.score.perfect ? 'perfect' : 'valid') : `invalid ${result.failureReason}`
      console.log(`[${results.length}/${jobs.length}] ${job.config.id} ${job.sample.id}: ${outcome} in ${(result.latencyMs / 1000).toFixed(1)}s`)
    }
  }))

  await mkdir(RESULTS_DIR, { recursive: true })
  const output = path.join(RESULTS_DIR, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  await writeFile(output, JSON.stringify(results, null, 2))
  summarize(results)
  console.log(`Saved ${path.relative(ROOT, output)}`)
}

if (import.meta.main) await main()
