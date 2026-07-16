import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const rootFile = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('public discoverability metadata', () => {
  it('publishes complete canonical, search, and social metadata', () => {
    const html = rootFile('index.html')
    expect(html).toContain('<title>Tally — Group Expense Splitter</title>')
    expect(html).toContain('name="description" content="Split group expenses')
    expect(html).toContain('rel="canonical" href="https://pengfanz.github.io/splitbill/"')
    expect(html).toContain('name="robots" content="index, follow, max-image-preview:large"')
    expect(html).toContain('property="og:title" content="Tally — Free Group Expense Splitter"')
    expect(html).toContain('property="og:image" content="https://pengfanz.github.io/splitbill/og.png"')
    expect(html).toContain('name="twitter:card" content="summary_large_image"')
  })

  it('publishes valid WebApplication structured data allowed by the content security policy', () => {
    const html = rootFile('index.html')
    const serialized = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)?.[1]
    expect(serialized).toBeTruthy()
    const metadata = JSON.parse(serialized!)
    expect(metadata).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      name: 'Tally',
      applicationCategory: 'FinanceApplication',
      isAccessibleForFree: true,
      offers: { price: '0', priceCurrency: 'USD' },
      inLanguage: ['en', 'zh-CN'],
    })
    const hash = createHash('sha256').update(serialized!).digest('base64')
    expect(html).toContain(`'sha256-${hash}'`)
  })

  it('allows crawling and lists only the canonical app URL in the sitemap', () => {
    const robots = rootFile('public/robots.txt')
    const sitemap = rootFile('public/sitemap.xml')
    expect(robots).toContain('User-agent: *\nAllow: /')
    expect(robots).toContain('Sitemap: https://pengfanz.github.io/splitbill/sitemap.xml')
    expect(sitemap).toContain('<loc>https://pengfanz.github.io/splitbill/</loc>')
    expect(sitemap.match(/<url>/g)).toHaveLength(1)
  })
})
