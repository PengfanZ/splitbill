import { expect, test, type BrowserContext, type Route } from '@playwright/test'

test.beforeEach(async ({ context }) => {
  await context.route('https://static.cloudflareinsights.com/**', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: '',
  }))
})

test('persists a selective equal split and deletes its activity safely', async ({ page }) => {
  const browserErrors: string[] = []
  page.on('console', message => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  page.on('pageerror', error => browserErrors.push(error.message))

  await page.goto('./')
  await expect(page).toHaveTitle('Tally — Shared expenses, settled')
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

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await expect(page.getByRole('button', { name: 'Delete Weekend activity' })).toBeVisible()

  page.once('dialog', dialog => dialog.dismiss())
  await page.getByRole('button', { name: 'Delete Weekend activity' }).click()
  await expect(page.getByRole('heading', { name: 'Weekend' })).toBeVisible()

  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Delete Weekend activity' }).click()
  await expect(page.getByRole('heading', { name: 'Start your first activity' })).toBeVisible()
  await expect(page.getByText('No activities yet.')).toBeVisible()
  expect(browserErrors).toEqual([])
})

test('shares a QR destination that opens the same read-only activity on another device', async ({ page, context, browser }) => {
  const browserErrors: string[] = []
  page.on('console', message => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  page.on('pageerror', error => browserErrors.push(error.message))
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:4173' })

  await page.goto('./')
  await page.getByLabel('Display name').fill('Alex')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Create an activity' }).click()
  await page.getByLabel('Activity name').fill('Weekend')
  await page.getByLabel(/Add friends/).fill('Maya')
  await page.getByRole('button', { name: 'Create activity' }).click()
  await page.getByRole('button', { name: 'Add expense' }).click()
  await page.getByLabel('Description').fill('Dinner')
  await page.getByRole('spinbutton', { name: 'Amount' }).fill('40')
  await page.getByRole('button', { name: 'Save expense' }).click()

  await page.getByRole('button', { name: 'Share QR' }).click()
  await expect(page.getByRole('dialog', { name: 'Scan to open Weekend' })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Weekend shared activity QR code' })).toBeVisible()
  await page.getByRole('button', { name: 'Copy link' }).click()
  const sharedUrl = await page.evaluate(() => navigator.clipboard.readText())
  expect(sharedUrl).toContain('/splitbill/#share=z.')

  const recipientContext = await browser.newContext()
  await recipientContext.route('https://static.cloudflareinsights.com/**', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: '',
  }))
  const recipientPage = await recipientContext.newPage()
  recipientPage.on('console', message => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  recipientPage.on('pageerror', error => browserErrors.push(error.message))
  await recipientPage.goto(sharedUrl)

  await expect(recipientPage.getByLabel('Shared activity preview')).toBeVisible()
  await expect(recipientPage.getByRole('heading', { name: 'Weekend' })).toBeVisible()
  await expect(recipientPage.getByText('Read-only snapshot')).toBeVisible()
  await expect(recipientPage.getByText('Dinner')).toBeVisible()
  await expect(recipientPage.getByText('Alex paid', { exact: true })).toBeVisible()
  await expect(recipientPage.getByRole('button', { name: 'Add expense' })).toHaveCount(0)
  expect(browserErrors).toEqual([])
  await recipientContext.close()
})

test('shares one editable backend activity across isolated browser sessions', async ({ page, context, browser }) => {
  const browserErrors: string[] = []
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
    if (functionName === 'create_shared_activity') {
      snapshot = body.p_snapshot
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ code, edit_token: editToken, revision, snapshot, updated_at: '2026-07-14T01:00:00.000Z' }]) })
      return
    }
    if (functionName === 'load_shared_activity') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ code, revision, snapshot, updated_at: '2026-07-14T01:00:00.000Z' }]) })
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
    await targetContext.route('https://static.cloudflareinsights.com/**', route => route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: '',
    }))
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
  await page.getByRole('button', { name: 'Share live' }).click()
  await expect(page.getByRole('dialog', { name: 'Scan to join Shared cabin' })).toBeVisible()
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

  const editorContext = await browser.newContext()
  await prepareSharedSession(editorContext)
  const editor = await editorContext.newPage()
  editor.on('console', message => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  editor.on('pageerror', error => browserErrors.push(error.message))
  await editor.goto(liveUrl)
  await editor.getByLabel('Display name').fill('Blair')
  await editor.getByRole('button', { name: 'Continue' }).click()
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

  // The creator is still on revision 2. Its first save receives the current
  // snapshot as a normal conflict result; the modal stays open for a retry.
  await page.getByRole('button', { name: 'Add expense' }).click()
  await page.getByLabel('Description').fill('Cabin fee')
  await page.getByRole('spinbutton', { name: 'Amount' }).fill('50')
  await page.getByRole('button', { name: 'Save expense' }).click()
  await expect(page.getByText('Live · revision 3')).toBeVisible()
  await expect(page.getByText('Firewood', { exact: true })).toBeVisible()
  await expect(page.getByText(/latest changes are loaded/i)).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Add a shared expense' })).toBeVisible()
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
  await observer.getByLabel('Display name').fill('Casey')
  await observer.getByRole('button', { name: 'Continue' }).click()
  await expect(observer.getByText('Live · revision 4')).toBeVisible()
  await expect(observer.getByText('Groceries', { exact: true })).toBeVisible()
  await expect(observer.getByText('Firewood', { exact: true })).toBeVisible()
  await expect(observer.getByText('Cabin fee', { exact: true })).toBeVisible()
  await expect(observer.getByText(`Live · ${code}`, { exact: true })).toBeVisible()
  expect(browserErrors).toEqual([])
  await editorContext.close()
  await observerContext.close()
})
