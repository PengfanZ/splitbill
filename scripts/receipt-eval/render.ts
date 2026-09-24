// Renders the synthetic receipt fixtures into phone-photo-like JPEGs that match
// the browser upload bounds (long edge <= 2048 px, JPEG quality 0.82).
//   node scripts/receipt-eval/render.ts
import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chargeCents, itemTotalCents, RECEIPT_FIXTURES, receiptTruth, type ReceiptFixture } from './fixtures.ts'

const OUTPUT_DIR = path.resolve(import.meta.dirname, '.cache/images')
const VIEWPORT = { width: 768, height: 1024 }

function escapeHtml(value: string) {
  return value.replace(/[&<>"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character]!)
}

function money(cents: number, fixture: ReceiptFixture) {
  const text = (Math.abs(cents) / 100).toFixed(2)
  const localized = fixture.currency === 'EUR' ? text.replace('.', ',') : text
  return `${cents < 0 ? '-' : ''}${localized}`
}

function symbolTotal(cents: number, fixture: ReceiptFixture) {
  const symbol = { USD: '$', CNY: '¥', EUR: '€', GBP: '£' }[fixture.currency]
  return fixture.currency === 'EUR' ? `${money(cents, fixture)} ${symbol}` : `${symbol}${money(cents, fixture)}`
}

function row(left: string, right = '', className = '') {
  return `<div class="row ${className}"><span>${escapeHtml(left)}</span><span>${escapeHtml(right)}</span></div>`
}

function receiptHtml(fixture: ReceiptFixture) {
  const truth = receiptTruth(fixture)
  const lines: string[] = [
    `<div class="center strong big">${escapeHtml(fixture.merchant)}</div>`,
    ...fixture.header.map(line => `<div class="center">${escapeHtml(line)}</div>`),
    `<div class="center">${escapeHtml(fixture.date)}</div>`,
    '<div class="rule"></div>',
  ]
  for (const item of fixture.items) {
    const quantity = item.quantity ?? 1
    lines.push(row(quantity > 1 ? `${quantity} x ${item.name}` : item.name, money(itemTotalCents(item), fixture)))
    if (quantity > 1) lines.push(row(`    @ ${money(item.unitCents, fixture)}`, '', 'detail'))
    for (const detail of item.details ?? []) {
      lines.push(row(`    ${detail.label}`, detail.cents === undefined ? '' : money(detail.cents, fixture), 'detail'))
    }
  }
  lines.push('<div class="rule"></div>')
  if (fixture.printSubtotal) lines.push(row(fixture.labels.subtotal, money(truth.subtotalCents, fixture)))
  for (const charge of fixture.charges) lines.push(row(charge.label, money(chargeCents(charge, truth.subtotalCents), fixture)))
  lines.push(row(fixture.labels.total, symbolTotal(truth.totalCents, fixture), 'strong big'))
  lines.push('<div class="rule"></div>')
  lines.push(...fixture.footer.map(line => `<div class="center pre">${escapeHtml(line)}</div>`))
  return lines.join('\n')
}

function pageHtml(fixture: ReceiptFixture) {
  const photo = fixture.style !== 'clean'
  const faded = fixture.style === 'faded'
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; width: ${VIEWPORT.width}px; height: ${VIEWPORT.height}px; overflow: hidden; }
    body { display: flex; align-items: center; justify-content: center;
      background: ${photo ? 'radial-gradient(circle at 30% 20%, #7a5b43, #3a281c 75%)' : '#ffffff'}; }
    #fit { transform-origin: center center; }
    #receipt { position: relative; width: 360px; padding: 22px 20px 30px;
      background: ${faded ? '#f1ecdc' : '#fbfbf8'}; color: ${faded ? '#858178' : '#1d1d1d'};
      font: 15px/1.38 "Courier New", "PingFang SC", monospace;
      ${photo ? `box-shadow: 0 18px 40px rgba(0,0,0,.45); transform: perspective(1400px) rotateX(7deg) rotate(${fixture.rotateDeg}deg);` : ''}
      filter: ${faded ? 'blur(0.85px) contrast(0.82)' : photo ? 'blur(0.35px)' : 'none'}; }
    #receipt::after { content: ""; position: absolute; inset: 0; pointer-events: none;
      background: ${photo ? 'linear-gradient(115deg, rgba(255,255,255,.18), rgba(0,0,0,0) 40%, rgba(0,0,0,.14))' : 'none'}
      ${faded ? ', repeating-linear-gradient(0deg, rgba(0,0,0,0) 0 140px, rgba(0,0,0,.07) 141px 143px)' : ''}; }
    .row { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
    .row span:first-child { white-space: pre; }
    .detail { font-size: 14px; }
    .center { text-align: center; } .pre { white-space: pre; }
    .strong { font-weight: 700; } .big { font-size: 17px; }
    .rule { border-top: 1px dashed currentColor; margin: 8px 0; }
  </style></head><body><div id="fit"><div id="receipt">${receiptHtml(fixture)}</div></div></body></html>`
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true })
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2 })
    for (const fixture of RECEIPT_FIXTURES) {
      await page.setContent(pageHtml(fixture))
      // Long receipts shrink to fit the frame, like a phone photo of the whole receipt.
      await page.evaluate(({ width, height }) => {
        const fit = document.getElementById('fit')!
        const box = document.getElementById('receipt')!.getBoundingClientRect()
        fit.style.transform = `scale(${Math.min(1, (height * 0.92) / box.height, (width * 0.92) / box.width)})`
      }, VIEWPORT)
      const image = await page.screenshot({ type: 'jpeg', quality: 82 })
      await writeFile(path.join(OUTPUT_DIR, `${fixture.id}.jpg`), image)
      await writeFile(path.join(OUTPUT_DIR, `${fixture.id}.json`), JSON.stringify({
        width: VIEWPORT.width * 2,
        height: VIEWPORT.height * 2,
        locale: fixture.locale,
        truth: receiptTruth(fixture),
      }, null, 2))
      console.log(`rendered ${fixture.id} (${Math.round(image.byteLength / 1024)} KB)`)
    }
  } finally {
    await browser.close()
  }
}

await main()
