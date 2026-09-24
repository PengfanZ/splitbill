// Downloads the openly licensed Wikimedia Commons receipt photos listed in
// commons-receipts.json and prepares them like the browser upload
// (long edge <= 2048 px, JPEG quality 82). Images stay in the ignored cache.
//   node scripts/receipt-eval/commons.ts
import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import type { ReceiptTruth } from './fixtures.ts'

const MANIFEST = path.join(import.meta.dirname, 'commons-receipts.json')
const OUTPUT_DIR = path.join(import.meta.dirname, '.cache/commons')
const USER_AGENT = 'TallyReceiptEval/1.0 (https://github.com/PengfanZ/splitbill)'
const run = promisify(execFile)

export type CommonsReceipt = {
  id: string
  title: string
  license: string
  author: string
  locale: 'en' | 'zh-CN'
  truth?: ReceiptTruth
  // Other readings of an ambiguous receipt that are equally correct for Tally.
  alternatives?: ReceiptTruth[]
  notes?: string
}

async function dimensions(file: string) {
  const { stdout } = await run('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file])
  return {
    width: Number(/pixelWidth: (\d+)/.exec(stdout)?.[1]),
    height: Number(/pixelHeight: (\d+)/.exec(stdout)?.[1]),
  }
}

async function imageUrl(title: string) {
  const query = new URLSearchParams({
    action: 'query', format: 'json', prop: 'imageinfo', iiprop: 'url|size', iiurlwidth: '2048', titles: `File:${title}`,
  })
  const response = await fetch(`https://commons.wikimedia.org/w/api.php?${query}`, { headers: { 'user-agent': USER_AGENT } })
  const payload = await response.json() as { query: { pages: Record<string, { imageinfo?: { url: string, thumburl?: string, width: number, height: number }[] }> } }
  const info = Object.values(payload.query.pages)[0]?.imageinfo?.[0]
  if (!info) throw new Error(`Missing Commons file: ${title}`)
  return info.width > 2048 || info.height > 2048 ? info.thumburl ?? info.url : info.url
}

async function main() {
  const receipts = JSON.parse(await readFile(MANIFEST, 'utf8')) as CommonsReceipt[]
  await mkdir(OUTPUT_DIR, { recursive: true })
  for (const receipt of receipts) {
    const response = await fetch(await imageUrl(receipt.title), { headers: { 'user-agent': USER_AGENT } })
    if (!response.ok) throw new Error(`Download failed for ${receipt.id}: HTTP ${response.status}`)
    const source = path.join(OUTPUT_DIR, `${receipt.id}.source`)
    const output = path.join(OUTPUT_DIR, `${receipt.id}.jpg`)
    await writeFile(source, Buffer.from(await response.arrayBuffer()))
    // macOS sips mirrors the browser's resize-then-JPEG step closely enough for model comparison.
    // Like the browser, only shrink: small originals keep their size.
    const sourceSize = await dimensions(source)
    const resize = Math.max(sourceSize.width, sourceSize.height) > 2048 ? ['-Z', '2048'] : []
    await run('sips', [...resize, '-s', 'format', 'jpeg', '-s', 'formatOptions', '82', source, '--out', output])
    const { width, height } = await dimensions(output)
    await writeFile(path.join(OUTPUT_DIR, `${receipt.id}.json`), JSON.stringify({
      width, height, locale: receipt.locale, truth: receipt.truth ?? null, alternatives: receipt.alternatives ?? [],
    }, null, 2))
    console.log(`prepared ${receipt.id} ${width}x${height} (${receipt.license})`)
  }
}

await main()
