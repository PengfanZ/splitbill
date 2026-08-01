import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test'

type AnalyticsPayload = {
  p_event_name: string
  p_surface: string
  p_session_token: string
  p_locale: 'en' | 'zh-CN'
  p_currency: string | null
}

async function chooseActivityCurrency(page: Page, currentCurrency: string, nextCurrency: string) {
  await page.getByRole('button', { name: `Activity currency, ${currentCurrency}` }).click()
  await page.getByRole('option', { name: nextCurrency }).click()
}

test.beforeEach(async ({ context }) => {
  await context.route('https://live-sharing.test/rest/v1/rpc/record_analytics_event', route => route.fulfill({
    status: 204,
    body: '',
  }))
})

test('automatically uses Simplified Chinese in China and keeps the choice across reloads', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'zh-CN', timezoneId: 'Asia/Shanghai' })
  const page = await context.newPage()
  const events: AnalyticsPayload[] = []
  await context.route('https://live-sharing.test/rest/v1/rpc/record_analytics_event', async route => {
    events.push(route.request().postDataJSON() as AnalyticsPayload)
    await route.fulfill({ status: 204, body: '' })
  })

  try {
    await page.goto('./')
    await expect(page).toHaveTitle('Tally — 多人分账工具')
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
    await expect(page.getByRole('heading', { name: '怎么称呼你？' })).toBeVisible()
    await expect(page.getByText('时间将按照 Asia/Shanghai 显示。')).toBeVisible()

    await page.getByLabel('显示名称').fill('鹏帆')
    await page.getByRole('button', { name: '继续' }).click()
    await page.getByRole('main').getByRole('button', { name: '创建活动' }).click()
    await page.getByLabel('活动名称').fill('周末旅行')
    await page.getByLabel(/添加朋友/).fill('小明')
    await page.getByRole('dialog').getByRole('button', { name: '创建活动' }).click()
    const localizedCurrency = page.getByRole('button', { name: '活动币种：人民币' })
    await expect(localizedCurrency).toContainText('人民币 · ¥')
    await localizedCurrency.click()
    await expect(page.getByRole('option', { name: '美元' })).toBeVisible()
    await expect(page.getByRole('option', { name: '人民币' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('option', { name: 'CNY' })).toHaveCount(0)
    await page.getByRole('option', { name: '欧元' }).click()
    await expect(page.getByRole('status')).toContainText('活动币种已更改为欧元')
    await page.getByRole('button', { name: '添加支出' }).click()
    await page.getByLabel('说明').fill('晚餐')
    await page.getByRole('spinbutton', { name: '金额' }).fill('80')
    await page.getByRole('button', { name: '保存支出' }).click()
    await expect(page.getByText(/^创建于 .*GMT\+8/)).toBeVisible()

    await page.getByRole('button', { name: '设置' }).click()
    await page.getByRole('button', { name: '语言：简体中文' }).click()
    await page.getByRole('option', { name: 'English' }).click()
    await expect(page).toHaveTitle('Tally — Group Expense Splitter')
    await page.getByRole('button', { name: 'Save name' }).click()
    await page.reload()
    await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect.poll(() => events.length).toBeGreaterThanOrEqual(4)
    expect(events[0]).toMatchObject({
      p_event_name: 'app_opened',
      p_surface: 'local',
      p_locale: 'zh-CN',
    })
    expect(events.at(-1)).toMatchObject({
      p_event_name: 'app_opened',
      p_surface: 'local',
      p_locale: 'en',
    })
    expect(events).toContainEqual(expect.objectContaining({
      p_event_name: 'currency_selected',
      p_locale: 'zh-CN',
      p_currency: 'EUR',
    }))
  } finally {
    await context.close()
  }
})

test('is installable and reloads the local app shell while offline', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()

  try {
    await page.goto('./')

    const metadata = await page.locator('head').evaluate(element => {
      const manifest = element.querySelector<HTMLLinkElement>('link[rel="manifest"]')
      const icons = [...element.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')]
      const appleIcon = element.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')
      const registerScript = element.querySelector<HTMLScriptElement>('script[src$="registerSW.js"]')
      const canonical = element.querySelector<HTMLLinkElement>('link[rel="canonical"]')
      const structuredData = element.querySelector<HTMLScriptElement>('script[type="application/ld+json"]')
      return {
        manifestHref: manifest?.getAttribute('href'),
        iconHrefs: icons.map(icon => icon.getAttribute('href')),
        appleIconHref: appleIcon?.getAttribute('href'),
        registerScriptSrc: registerScript?.getAttribute('src'),
        canonicalHref: canonical?.href,
        openGraphTitle: element.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content,
        structuredData: structuredData?.textContent ? JSON.parse(structuredData.textContent) : null,
      }
    })
    expect(metadata).toEqual({
      manifestHref: '/splitbill/manifest.webmanifest',
      iconHrefs: ['/splitbill/favicon.ico', '/splitbill/favicon.svg'],
      appleIconHref: '/splitbill/apple-touch-icon-180x180.png',
      registerScriptSrc: '/splitbill/registerSW.js',
      canonicalHref: 'https://pengfanz.github.io/splitbill/',
      openGraphTitle: 'Tally — Free Group Expense Splitter',
      structuredData: expect.objectContaining({ '@type': 'WebApplication', name: 'Tally' }),
    })

    const [robotsResponse, sitemapResponse] = await Promise.all([
      page.request.get('/splitbill/robots.txt'),
      page.request.get('/splitbill/sitemap.xml'),
    ])
    expect(robotsResponse.ok()).toBe(true)
    expect(await robotsResponse.text()).toContain('Sitemap: https://pengfanz.github.io/splitbill/sitemap.xml')
    expect(sitemapResponse.ok()).toBe(true)
    expect(await sitemapResponse.text()).toContain('<loc>https://pengfanz.github.io/splitbill/</loc>')

    const manifestResponse = await page.request.get('/splitbill/manifest.webmanifest')
    expect(manifestResponse.ok()).toBe(true)
    expect(manifestResponse.headers()['content-type']).toContain('application/manifest+json')
    expect(await manifestResponse.json()).toMatchObject({
      id: './',
      name: 'Tally — Group expense splitter',
      short_name: 'Tally',
      start_url: './',
      scope: './',
      display: 'standalone',
      icons: [
        { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
        { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
        { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
        { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    })

    await page.getByLabel('Display name').fill('Offline Tester')
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByRole('button', { name: 'Create an activity' }).click()
    await page.getByLabel('Activity name').fill('Offline trip')
    await page.getByLabel(/Add friends/).fill('Maya')
    await page.getByRole('button', { name: 'Create activity' }).click()

    await page.evaluate(() => navigator.serviceWorker.ready)
    await page.reload()
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null)).toContain('/splitbill/sw.js')
    const controlledResponse = await page.goto('./')
    expect(controlledResponse?.fromServiceWorker()).toBe(true)
    const cachedUrls = await page.evaluate(async () => {
      const cacheNames = await caches.keys()
      const requests = await Promise.all(cacheNames.map(async cacheName => (await caches.open(cacheName)).keys()))
      return requests.flat().map(request => request.url)
    })
    expect(cachedUrls.some(url => url.includes('supabase.co'))).toBe(false)
    expect(cachedUrls.some(url => url.endsWith('/og.png'))).toBe(false)
    expect(cachedUrls.some(url => /\/assets\/index-.+\.js$/.test(url))).toBe(true)
    expect(cachedUrls.some(url => /\/assets\/index-.+\.css$/.test(url))).toBe(true)

    const blockedRequests: Array<{ ownedByServiceWorker: boolean, url: string }> = []
    await context.route('**/*', route => {
      blockedRequests.push({
        ownedByServiceWorker: Boolean(route.request().serviceWorker()),
        url: route.request().url(),
      })
      return route.abort('internetdisconnected')
    })
    const offlineResponse = await page.goto('./')
    expect(offlineResponse?.fromServiceWorker()).toBe(true)
    await expect(page).toHaveTitle('Tally — Group Expense Splitter')
    expect(blockedRequests.every(request => (
      !request.ownedByServiceWorker && !request.url.startsWith('http://127.0.0.1:4173/splitbill/')
    ))).toBe(true)
    await expect(page.getByRole('heading', { name: 'Offline trip' })).toBeVisible()
  } finally {
    await context.unroute('**/*')
    await context.close()
  }
})

test('keeps the expense action reachable on a short mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 667 })
  await page.goto('./')
  await page.getByLabel('Display name').fill('Mobile Tester')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Create an activity' }).click()
  await page.getByLabel('Activity name').fill('Mobile weekend')
  await page.getByLabel(/Add friends/).fill('Maya')
  await page.getByRole('button', { name: 'Create activity' }).click()
  await page.getByRole('button', { name: 'Add expense' }).click()

  const saveExpense = page.getByRole('button', { name: 'Save expense' })
  await expect(saveExpense).toBeVisible()
  const actionBounds = await saveExpense.evaluate(element => {
    const bounds = element.getBoundingClientRect()
    return { top: bounds.top, bottom: bounds.bottom }
  })
  expect(actionBounds.top).toBeGreaterThanOrEqual(0)
  expect(actionBounds.bottom).toBeLessThanOrEqual(667)

  await page.getByLabel('Description').fill('Mobile dinner')
  await page.getByRole('spinbutton', { name: 'Amount' }).fill('24')
  await saveExpense.click()
  await expect(page.getByText('Mobile dinner')).toBeVisible()
})

test('keeps an activity currency across expenses, changes, and reloads', async ({ page }) => {
  await page.goto('./')
  await page.getByLabel('Display name').fill('Currency Tester')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Create an activity' }).click()
  await page.getByLabel('Activity name').fill('Europe trip')
  await page.getByRole('button', { name: /Activity currency/ }).click()
  await page.getByRole('option', { name: 'EUR' }).click()
  await page.getByLabel(/Add friends/).fill('Maya')
  await page.getByRole('button', { name: 'Create activity' }).click()

  await expect(page.getByRole('button', { name: 'Activity currency, EUR' })).toBeVisible()
  await page.getByRole('button', { name: 'Add expense' }).click()
  await page.getByLabel('Description').fill('Train')
  await page.getByRole('spinbutton', { name: 'Amount' }).fill('18')
  await page.getByRole('button', { name: 'Save expense' }).click()
  await expect(page.locator('.expense-amount b')).toHaveText('€18.00')

  await chooseActivityCurrency(page, 'EUR', 'CNY')
  await expect(page.getByRole('status')).toContainText('Activity currency changed to CNY')
  await expect(page.locator('.expense-amount b')).toHaveText('¥18.00')
  await page.reload()
  await expect(page.getByRole('button', { name: 'Activity currency, CNY' })).toBeVisible()
  await expect(page.locator('.expense-amount b')).toHaveText('¥18.00')
})

test('centers the create activity dialog on mobile and completes the flow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('./')
  await page.getByLabel('Display name').fill('Mobile Creator')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Create an activity' }).click()

  const dialog = page.getByRole('dialog', { name: 'What are you sharing?' })
  await expect(dialog).toBeVisible()
  await expect.poll(async () => dialog.evaluate(element => {
    const bounds = element.getBoundingClientRect()
    return Math.abs(bounds.top + bounds.height / 2 - window.innerHeight / 2)
  })).toBeLessThanOrEqual(1)
  const dialogBounds = await dialog.evaluate(element => {
    const bounds = element.getBoundingClientRect()
    return {
      centerX: bounds.left + bounds.width / 2,
      centerY: bounds.top + bounds.height / 2,
      left: bounds.left,
      right: bounds.right,
    }
  })
  expect(dialogBounds.centerX).toBeCloseTo(195, 0)
  expect(dialogBounds.centerY).toBeCloseTo(422, 0)
  expect(dialogBounds.left).toBeGreaterThanOrEqual(12)
  expect(dialogBounds.right).toBeLessThanOrEqual(378)

  await page.getByLabel('Activity name').fill('Centered weekend')
  await page.getByLabel(/Add friends/).fill('Maya')
  await page.getByRole('button', { name: 'Create activity' }).click()
  await expect(page.getByRole('heading', { name: 'Centered weekend' })).toBeVisible()
})

test('keeps share and add expense together in the mobile action row', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('./')
  await page.getByLabel('Display name').fill('Mobile Sharer')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Create an activity' }).click()
  await page.getByLabel('Activity name').fill('Aligned weekend')
  await page.getByRole('button', { name: 'Create activity' }).click()

  await page.getByRole('button', { name: 'Add expense' }).click()
  await page.getByLabel('Description').fill('Lunch')
  await page.getByRole('spinbutton', { name: 'Amount' }).fill('24')
  await page.getByRole('button', { name: 'Save expense' }).click()

  const actionRow = page.locator('.group-primary-actions')
  await expect(actionRow.getByRole('button', { name: 'Add expense' })).toBeVisible()
  await expect(actionRow.getByRole('button', { name: 'Share', exact: true })).toBeVisible()

  const layout = await actionRow.evaluate(element => {
    const buttons = Array.from(element.querySelectorAll('button')).map(button => {
      const bounds = button.getBoundingClientRect()
      return {
        label: button.textContent?.trim(),
        top: bounds.top,
        right: bounds.right,
        bottom: bounds.bottom,
        left: bounds.left,
        width: bounds.width,
      }
    })
    return {
      addExpense: buttons.find(button => button.label === 'Add expense'),
      share: buttons.find(button => button.label === 'Share'),
      viewportWidth: window.innerWidth,
    }
  })

  expect(layout.addExpense).toBeDefined()
  expect(layout.share).toBeDefined()
  expect(Math.abs(layout.addExpense!.top - layout.share!.top)).toBeLessThanOrEqual(1)
  expect(Math.abs(layout.addExpense!.bottom - layout.share!.bottom)).toBeLessThanOrEqual(1)
  expect(layout.addExpense!.left).toBeGreaterThanOrEqual(20)
  expect(layout.share!.right).toBeLessThanOrEqual(layout.viewportWidth - 20)
  expect(layout.addExpense!.width).toBeGreaterThan(layout.share!.width)

  const touchTargets = [
    page.getByRole('button', { name: 'Open navigation' }),
    page.getByRole('button', { name: 'Settings' }),
    page.getByRole('button', { name: 'Edit Lunch' }),
    page.getByRole('button', { name: 'Delete Lunch' }),
    actionRow.getByRole('button', { name: 'Add expense' }),
    actionRow.getByRole('button', { name: 'Share', exact: true }),
  ]
  for (const target of touchTargets) {
    const bounds = await target.boundingBox()
    expect(bounds?.width).toBeGreaterThanOrEqual(44)
    expect(bounds?.height).toBeGreaterThanOrEqual(44)
  }

  await actionRow.getByRole('button', { name: 'Share', exact: true }).click()
  const shareDialog = page.getByRole('dialog', { name: 'Share activity' })
  await expect(shareDialog).toBeVisible()
  await expect(shareDialog.getByRole('button', { name: 'Start live activity' })).toBeVisible()
  await expect(shareDialog.getByRole('button', { name: /^Share balances only/ })).toBeVisible()
  await expect(shareDialog.getByText(/snapshot/i)).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(shareDialog).toHaveCount(0)
  await expect(actionRow.getByRole('button', { name: 'Share', exact: true })).toBeFocused()
})

test('centers compact mobile dialogs and keeps long forms as sheets', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 667 })
  await page.goto('./')

  await expect(page.locator('.modal-backdrop')).toHaveClass(/modal-backdrop--center/)
  await page.getByLabel('Display name').fill('Modal Tester')
  await page.getByRole('button', { name: 'Continue' }).click()

  await page.getByRole('button', { name: 'Create an activity' }).click()
  await expect(page.locator('.modal-backdrop')).toHaveClass(/modal-backdrop--center/)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'What are you sharing?' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Create an activity' })).toBeFocused()
  await page.getByRole('button', { name: 'Create an activity' }).click()
  await page.getByLabel('Activity name').fill('Modal weekend')
  await page.getByLabel(/Add friends/).fill('Maya')
  await page.getByRole('button', { name: 'Create activity' }).click()

  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.locator('.modal-backdrop')).toHaveClass(/modal-backdrop--center/)
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()

  await page.getByRole('button', { name: 'Add friend' }).click()
  await expect(page.locator('.modal-backdrop')).toHaveClass(/modal-backdrop--center/)
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()

  await page.getByRole('button', { name: 'Add expense' }).click()
  await expect(page.locator('.modal-backdrop')).toHaveClass(/modal-backdrop--sheet/)
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()

  await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.getByRole('button', { name: 'Join activity' }).click()
  await expect(page.locator('.modal-backdrop')).toHaveClass(/modal-backdrop--center/)
})

test('shows new updates once and keeps the changelog available on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => {
    localStorage.setItem('tally:identity:v1', JSON.stringify({
      id: 'me',
      name: 'Returning Tester',
      initials: 'RT',
      color: '#f4cfb6',
    }))
  })

  await page.goto('./')
  const update = page.getByRole('dialog', { name: 'What’s new in Tally' })
  await expect(update).toBeVisible()
  await expect(update).toContainText('Sharing, without the guesswork')
  await expect(update).toContainText('Reliable live collaboration')
  await update.evaluate(element => Promise.all(
    element.getAnimations().map(animation => animation.finished),
  ))
  const updateBounds = await update.evaluate(element => {
    const bounds = element.getBoundingClientRect()
    return {
      centered: Math.abs(bounds.top + bounds.height / 2 - window.innerHeight / 2),
      withinViewport: bounds.top >= 12 && bounds.bottom <= window.innerHeight - 12,
    }
  })
  expect(updateBounds.centered).toBeLessThanOrEqual(1)
  expect(updateBounds.withinViewport).toBe(true)

  await page.getByRole('button', { name: 'Got it' }).click()
  await expect(update).toBeHidden()
  await page.reload()
  await expect(page.getByRole('dialog', { name: 'What’s new in Tally' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.getByRole('button', { name: 'What’s new' }).click()
  await expect(page.getByRole('dialog', { name: 'What’s new in Tally' })).toBeVisible()
  await expect(page.getByLabel('New updates')).toHaveCount(0)
})

test('tracks local outcomes without sending local activity data or loading third-party analytics', async ({ page, context }) => {
  const events: AnalyticsPayload[] = []
  const thirdPartyRequests: string[] = []
  page.on('request', request => {
    if (request.url().includes('cloudflareinsights.com')) thirdPartyRequests.push(request.url())
  })
  await context.route('https://live-sharing.test/rest/v1/rpc/record_analytics_event', async route => {
    events.push(route.request().postDataJSON() as AnalyticsPayload)
    await route.fulfill({ status: 204, body: '' })
  })

  await page.goto('./')
  await page.getByLabel('Display name').fill('Private Person')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Create an activity' }).click()
  await page.getByLabel('Activity name').fill('Secret local weekend')
  await page.getByRole('button', { name: /Activity currency/ }).click()
  await page.getByRole('option', { name: 'CNY' }).click()
  await page.getByRole('button', { name: 'Create activity' }).click()
  await page.getByRole('button', { name: 'Add friend' }).click()
  await page.getByLabel(/Friend names/).fill('Private Friend')
  await page.getByRole('button', { name: 'Add friends' }).click()
  await chooseActivityCurrency(page, 'CNY', 'EUR')
  await page.getByRole('button', { name: 'Add expense' }).click()
  await page.getByLabel('Description').fill('Private dinner description')
  await page.getByRole('spinbutton', { name: 'Amount' }).fill('42.37')
  await page.getByRole('button', { name: 'Save expense' }).click()

  await page.getByRole('button', { name: 'Share' }).click()
  const summaryDownload = page.waitForEvent('download')
  await page
    .getByRole('dialog', { name: 'Share activity' })
    .getByRole('button', { name: /^Share balances only/ })
    .click()
  await summaryDownload

  await expect.poll(() => events.length).toBe(7)
  const sessionTokens = new Set(events.map(event => event.p_session_token))
  expect(events.map(({ p_event_name, p_surface, p_locale, p_currency }) => ({ p_event_name, p_surface, p_locale, p_currency }))).toEqual([
    { p_event_name: 'app_opened', p_surface: 'local', p_locale: 'en', p_currency: null },
    { p_event_name: 'currency_selected', p_surface: 'local', p_locale: 'en', p_currency: 'CNY' },
    { p_event_name: 'activity_created', p_surface: 'local', p_locale: 'en', p_currency: null },
    { p_event_name: 'friend_added', p_surface: 'local', p_locale: 'en', p_currency: null },
    { p_event_name: 'currency_selected', p_surface: 'local', p_locale: 'en', p_currency: 'EUR' },
    { p_event_name: 'expense_added', p_surface: 'local', p_locale: 'en', p_currency: null },
    { p_event_name: 'summary_export_clicked', p_surface: 'local', p_locale: 'en', p_currency: null },
  ])
  expect(sessionTokens.size).toBe(1)
  expect([...sessionTokens][0]).toMatch(/^[a-f0-9]{32}$/)
  expect(JSON.stringify(events)).not.toMatch(/Private|Secret|dinner|42\.37|#live=|#share=/i)
  expect(thirdPartyRequests).toEqual([])
})

test('persists a selective equal split and deletes its activity safely', async ({ page }) => {
  const browserErrors: string[] = []
  page.on('console', message => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  page.on('pageerror', error => browserErrors.push(error.message))

  await page.goto('./')
  await expect(page).toHaveTitle('Tally — Group Expense Splitter')
  await page.getByLabel('Display name').fill('Alex')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Create an activity' }).click()
  await page.getByLabel('Activity name').fill('Weekend')
  await page.getByLabel(/Add friends/).fill('Maya, Jordan')
  await page.getByRole('button', { name: 'Create activity' }).click()

  await page.getByRole('button', { name: 'Add expense' }).click()
  await page.getByLabel('Description').fill('Museum tickets')
  await page.getByRole('spinbutton', { name: 'Amount' }).fill('60')
  await page.getByLabel('Include Jordan in equal split').uncheck()
  await expect(page.getByText('2 of 3 selected')).toBeVisible()
  await expect(page.getByText('$30.00')).toBeVisible()
  await page.getByRole('button', { name: 'Save expense' }).click()

  await expect(page.getByText('Split equally · 2 people')).toBeVisible()
  await expect(page.getByText(/^Created /)).toBeVisible()
  await expect(page.getByText('Maya owes Alex')).toBeVisible()
  await expect(page.getByText('Jordan owes Alex')).toHaveCount(0)

  const settlementRow = page.locator('.settlement-row').filter({ hasText: 'Maya owes Alex' })
  await expect(settlementRow).toContainText('$30.00')
  await settlementRow.getByRole('button', { name: 'Settle up' }).click()
  await expect(page.getByRole('heading', { name: 'Record a settlement' })).toBeVisible()
  await page.getByRole('spinbutton', { name: 'Payment amount' }).fill('10')
  await page.getByRole('button', { name: 'Record payment' }).click()
  await expect(settlementRow).toContainText('$20.00')
  await expect(page.getByText('Maya paid Alex', { exact: true })).toBeVisible()
  await expect(page.getByText('Settlement payment')).toBeVisible()
  await expect(page.getByLabel('Total spent').getByText('$60.00')).toBeVisible()

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Weekend' })).toBeVisible()
  await expect(page.getByText('Split equally · 2 people')).toBeVisible()
  await expect(page.getByText('Maya owes Alex')).toBeVisible()
  await expect(settlementRow).toContainText('$20.00')
  await expect(page.getByText('Maya paid Alex', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Add friend' }).first().click()
  await expect(page.getByText('1 existing expense will stay unchanged.')).toBeVisible()
  await page.getByLabel(/Friend names/).fill('Sam')
  await page.getByRole('button', { name: 'Add friends' }).click()
  await page.getByRole('button', { name: 'Edit Museum tickets' }).click()
  await expect(page.getByText('2 of 4 selected')).toBeVisible()
  await expect(page.getByLabel('Include Sam in equal split')).not.toBeChecked()
  await page.getByLabel('Include Sam in equal split').check()
  await expect(page.getByText('3 of 4 selected')).toBeVisible()
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Split equally · 3 people')).toBeVisible()
  await expect(page.getByText(/^Edited /)).toBeVisible()

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await expect(page.getByRole('button', { name: 'Delete Weekend activity' })).toBeVisible()

  await page.getByRole('button', { name: 'Delete Weekend activity' }).click()
  const confirmation = page.getByRole('dialog', { name: 'Delete this activity?' })
  await expect(confirmation).toContainText('This cannot be undone')
  await confirmation.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('heading', { name: 'Weekend' })).toBeVisible()

  await page.getByRole('button', { name: 'Delete Weekend activity' }).click()
  await page.getByRole('dialog', { name: 'Delete this activity?' }).getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByRole('heading', { name: 'Start your first activity' })).toBeVisible()
  await expect(page.getByText('No activities yet.')).toBeVisible()
  expect(browserErrors).toEqual([])
})

test('shares one editable backend activity across isolated browser sessions', async ({ page, context, browser }) => {
  const browserErrors: string[] = []
  const liveAnalyticsEvents: AnalyticsPayload[] = []
  page.on('console', message => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  page.on('pageerror', error => browserErrors.push(error.message))
  const code = 'A1B2C3D4E5'
  const editToken = 'a'.repeat(64)
  let revision = 1
  let snapshot: unknown

  const handleLiveBackend = async (route: Route) => {
    const functionName = new URL(route.request().url()).pathname.split('/').at(-1)
    const body = route.request().postDataJSON()
    if (functionName === 'record_analytics_event') {
      liveAnalyticsEvents.push(body as AnalyticsPayload)
      await route.fulfill({ status: 204, body: '' })
      return
    }
    if (functionName === 'create_shared_activity') {
      snapshot = body.p_snapshot
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ code, edit_token: editToken, revision, snapshot, updated_at: '2026-07-14T01:00:00.000Z' }]) })
      return
    }
    if (functionName === 'load_shared_activity') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ code, revision, snapshot, updated_at: '2026-07-14T01:00:00.000Z' }]) })
      return
    }
    if (functionName === 'poll_shared_activity') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ code, revision, updated_at: '2026-07-14T01:00:00.000Z' }]) })
      return
    }
    if (body.p_expected_revision !== revision) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ code, revision, snapshot, updated_at: '2026-07-14T01:01:00.000Z', conflicted: true }]),
      })
      return
    }
    snapshot = body.p_snapshot
    revision += 1
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ code, revision, snapshot, updated_at: '2026-07-14T01:01:00.000Z', conflicted: false }]),
    })
  }
  const prepareSharedSession = async (targetContext: BrowserContext) => {
    await targetContext.route('https://live-sharing.test/rest/v1/rpc/**', handleLiveBackend)
  }
  await context.route('https://live-sharing.test/rest/v1/rpc/**', handleLiveBackend)
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:4173' })

  await page.goto('./')
  await page.getByLabel('Display name').fill('Alex')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Create an activity' }).click()
  await page.getByLabel('Activity name').fill('Shared cabin')
  await page.getByLabel(/Add friends/).fill('Maya')
  await page.getByRole('button', { name: 'Create activity' }).click()
  await page.getByRole('button', { name: 'New activity' }).click()
  await page.getByLabel('Activity name').fill('Local dinner')
  await page.getByRole('button', { name: 'Create activity' }).click()
  await page.getByRole('button', { name: 'Open Shared cabin activity' }).click()
  await page.getByRole('button', { name: 'Share', exact: true }).click()
  const shareDialog = page.getByRole('dialog', { name: 'Share activity' })
  await expect(shareDialog.getByRole('button', { name: 'Start live activity' })).toBeVisible()
  await expect(shareDialog.getByRole('button', { name: /^Share balances only/ })).toBeVisible()
  await expect(shareDialog.getByText(/snapshot/i)).toHaveCount(0)
  await shareDialog.getByRole('button', { name: 'Start live activity' }).click()
  await expect(page.getByRole('dialog', { name: 'Scan to join Shared cabin' })).toBeVisible()
  await expect.poll(() => liveAnalyticsEvents.map(event => event.p_event_name)).toContain('live_activity_created')
  const liveEventNames = liveAnalyticsEvents.map(event => event.p_event_name)
  expect(liveEventNames.indexOf('live_share_clicked')).toBeGreaterThanOrEqual(0)
  expect(liveEventNames.indexOf('live_share_clicked')).toBeLessThan(liveEventNames.indexOf('live_activity_created'))
  expect(liveAnalyticsEvents.find(event => event.p_event_name === 'live_share_clicked')).toEqual(expect.objectContaining({
    p_surface: 'local',
    p_locale: 'en',
    p_currency: null,
  }))
  expect(JSON.stringify(liveAnalyticsEvents)).not.toMatch(/Shared cabin|#live=|A1B2C3D4E5/i)
  await page.getByRole('button', { name: 'Copy link' }).click()
  const liveUrl = await page.evaluate(() => navigator.clipboard.readText())
  expect(liveUrl).toContain(`#live=${code}.${editToken}`)
  await expect(page.getByText('Live · revision 1')).toBeVisible()

  await page.getByRole('button', { name: 'Add expense' }).click()
  await page.getByLabel('Description').fill('Groceries')
  await page.getByRole('spinbutton', { name: 'Amount' }).fill('30')
  await page.getByRole('button', { name: 'Save expense' }).click()
  await expect(page.getByText('Groceries', { exact: true })).toBeVisible()
  await expect(page.getByText('Live · revision 2')).toBeVisible()

  await expect(page.getByRole('button', { name: 'Back to my activities' })).toHaveCount(0)
  await expect(page.getByText(`Live · ${code}`, { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open Shared cabin activity' }).locator('..')).toHaveClass(/is-selected/)
  await page.getByRole('button', { name: 'Open Local dinner activity' }).click()
  await expect(page.getByRole('heading', { name: 'Local dinner' })).toBeVisible()
  await expect(page).not.toHaveURL(/#live=/)
  await page.getByRole('button', { name: 'Open Shared cabin activity' }).click()
  await expect(page.getByText('Live · revision 2')).toBeVisible()
  await page.reload()
  await expect(page.getByText('Live · revision 2')).toBeVisible()
  await expect(page.getByText('Groceries', { exact: true })).toBeVisible()
  const creatorMirrors = await page.evaluate(() => {
    const rawMirrors = localStorage.getItem('tally:live-activity-mirrors:v1')
    return rawMirrors ? JSON.parse(rawMirrors) as Record<string, { revision: number; snapshot: { group: { name: string }; expenses: { title: string }[] } }> : {}
  })
  expect(Object.values(creatorMirrors)).toEqual(expect.arrayContaining([
    expect.objectContaining({
      revision: 2,
      snapshot: expect.objectContaining({
        group: expect.objectContaining({ name: 'Shared cabin' }),
        expenses: expect.arrayContaining([expect.objectContaining({ title: 'Groceries' })]),
      }),
    }),
  ]))

  const legacyContext = await browser.newContext()
  await prepareSharedSession(legacyContext)
  await legacyContext.addInitScript(({ legacyCode, legacyEditToken }) => {
    localStorage.setItem('tally:identity:v1', JSON.stringify({
      id: 'me',
      name: 'Legacy user',
      initials: 'LU',
      color: '#ead1b9',
    }))
    localStorage.setItem('tally:frontend:v2', JSON.stringify({
      groups: [{ id: 'legacy-trip', name: 'Shared cabin', emoji: '✦', memberIds: ['me'] }],
      friends: [],
      expenses: [],
      selectedGroupId: 'legacy-trip',
    }))
    localStorage.setItem('tally:live-activity-bookmarks:v1', JSON.stringify({
      'legacy-trip': { code: legacyCode, editToken: legacyEditToken },
    }))
  }, { legacyCode: code, legacyEditToken: editToken })
  const legacyPage = await legacyContext.newPage()
  legacyPage.on('console', message => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  legacyPage.on('pageerror', error => browserErrors.push(error.message))
  await legacyPage.goto('./')
  await expect(legacyPage).toHaveURL(new RegExp(`#live=${code}\\.${editToken}`))
  await expect(legacyPage.getByText('Live · revision 2')).toBeVisible()
  await expect(legacyPage.getByText('Groceries', { exact: true })).toBeVisible()
  await expect(legacyPage.getByRole('button', { name: 'Add expense' })).toBeVisible()
  const upgradedLegacyMirror = await legacyPage.evaluate(() => {
    const mirrors = JSON.parse(localStorage.getItem('tally:live-activity-mirrors:v1') ?? '{}')
    return mirrors['legacy-trip']
  })
  expect(upgradedLegacyMirror).toEqual(expect.objectContaining({
    code,
    revision: 2,
    snapshot: expect.objectContaining({
      expenses: expect.arrayContaining([expect.objectContaining({ title: 'Groceries' })]),
    }),
  }))

  const editorContext = await browser.newContext()
  await prepareSharedSession(editorContext)
  const editor = await editorContext.newPage()
  editor.on('console', message => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  editor.on('pageerror', error => browserErrors.push(error.message))
  await editor.goto('./')
  await editor.getByLabel('Display name').fill('Blair')
  await editor.getByRole('button', { name: 'Continue' }).click()
  await editor.getByRole('button', { name: 'Join from a link' }).click()
  await editor.getByLabel('Shared activity link').fill(liveUrl)
  await editor.getByRole('button', { name: 'Open activity' }).click()
  await expect(editor.getByText('Live · revision 2')).toBeVisible()
  await expect(editor.getByText('Groceries', { exact: true })).toBeVisible()
  await expect(editor.getByText(`Live · ${code}`, { exact: true })).toBeVisible()
  await expect(editor.getByRole('button', { name: 'Back to my activities' })).toHaveCount(0)
  await editor.goto(`${new URL(liveUrl).origin}/`)
  await expect(editor).toHaveURL(new RegExp(`#live=${code}\\.`))
  await expect(editor.getByText('Live · revision 2')).toBeVisible()
  await editor.getByRole('button', { name: 'Add expense' }).click()
  await editor.getByLabel('Description').fill('Firewood')
  await editor.getByRole('spinbutton', { name: 'Amount' }).fill('24')
  await editor.getByRole('button', { name: 'Save expense' }).click()
  await expect(editor.getByText('Firewood', { exact: true })).toBeVisible()
  await expect(editor.getByText('Live · revision 3')).toBeVisible()

  await page.bringToFront()
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByText('Live · revision 3')).toBeVisible()
  await expect(page.getByText('Firewood', { exact: true })).toBeVisible()
  await expect(page.getByRole('status')).toContainText('New shared changes loaded automatically')

  await page.getByRole('button', { name: 'Add expense' }).click()
  await page.getByLabel('Description').fill('Cabin fee')
  await page.getByRole('spinbutton', { name: 'Amount' }).fill('50')
  await page.getByRole('button', { name: 'Save expense' }).click()
  await expect(page.getByText('Cabin fee', { exact: true })).toBeVisible()
  await expect(page.getByText('Live · revision 4')).toBeVisible()

  const observerContext = await browser.newContext()
  await prepareSharedSession(observerContext)
  const observer = await observerContext.newPage()
  observer.on('console', message => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  observer.on('pageerror', error => browserErrors.push(error.message))
  await observer.goto(liveUrl)
  await expect(observer.getByLabel('Continue in installed Tally')).toBeVisible()
  await observer.getByLabel('Display name').fill('Casey')
  await observer.getByRole('button', { name: 'Continue' }).click()
  await expect(observer.getByText('Live · revision 4')).toBeVisible()
  await expect(observer.getByText('Groceries', { exact: true })).toBeVisible()
  await expect(observer.getByText('Firewood', { exact: true })).toBeVisible()
  await expect(observer.getByText('Cabin fee', { exact: true })).toBeVisible()
  await expect(observer.getByText(`Live · ${code}`, { exact: true })).toBeVisible()

  await editorContext.setOffline(true)
  await editor.bringToFront()
  await expect(editor.getByText('You’re offline')).toBeVisible()
  await expect(editor.getByText('This is your last synced copy. Editing is paused until Tally reconnects, or you can create an independent copy.')).toBeVisible()
  await expect(editor.getByText('Firewood', { exact: true })).toBeVisible()
  await expect(editor.getByRole('button', { name: 'Add expense' })).toHaveCount(0)
  await editor.getByRole('button', { name: 'Duplicate and edit' }).click()
  await expect(editor.getByRole('heading', { name: 'Who are you in this copy?' })).toBeVisible()
  await editor.getByRole('button', { name: 'Create editable copy' }).click()
  await expect(editor.getByRole('heading', { name: 'Shared cabin copy' })).toBeVisible()
  await expect(editor.getByRole('button', { name: 'Add expense' })).toBeVisible()
  await expect(editor.getByText('Firewood', { exact: true })).toBeVisible()

  expect(browserErrors).toEqual([])
  await legacyContext.close()
  await editorContext.close()
  await observerContext.close()
})
