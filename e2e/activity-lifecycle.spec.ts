import { expect, test } from '@playwright/test'

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

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Weekend' })).toBeVisible()
  await expect(page.getByText('Split equally · 2 people')).toBeVisible()
  await expect(page.getByText('Maya owes Alex')).toBeVisible()

  await page.getByRole('button', { name: 'Add friend' }).first().click()
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

test('shares one editable backend activity across browser pages', async ({ page, context }) => {
  const code = 'A1B2C3D4E5'
  const editToken = 'a'.repeat(64)
  let revision = 1
  let snapshot: unknown

  await context.route('https://live-sharing.test/rest/v1/rpc/**', async route => {
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
    snapshot = body.p_snapshot
    revision += 1
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ code, revision, snapshot, updated_at: '2026-07-14T01:01:00.000Z' }]) })
  })
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:4173' })

  await page.goto('./')
  await page.getByLabel('Display name').fill('Alex')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Create an activity' }).click()
  await page.getByLabel('Activity name').fill('Shared cabin')
  await page.getByLabel(/Add friends/).fill('Maya')
  await page.getByRole('button', { name: 'Create activity' }).click()
  await page.getByRole('button', { name: 'Share live' }).click()
  await expect(page.getByRole('dialog', { name: 'Scan to join Shared cabin' })).toBeVisible()
  await page.getByRole('button', { name: 'Copy link' }).click()
  const liveUrl = await page.evaluate(() => navigator.clipboard.readText())
  expect(liveUrl).toContain(`#live=${code}.${editToken}`)

  const editor = await context.newPage()
  await editor.goto(liveUrl)
  await expect(editor.getByText('Live · revision 1')).toBeVisible()
  await editor.getByRole('button', { name: 'Add expense' }).click()
  await editor.getByLabel('Description').fill('Firewood')
  await editor.getByRole('spinbutton', { name: 'Amount' }).fill('24')
  await editor.getByRole('button', { name: 'Save expense' }).click()
  await expect(editor.getByText('Firewood', { exact: true })).toBeVisible()
  await expect(editor.getByText('Live · revision 2')).toBeVisible()

  const observer = await context.newPage()
  await observer.goto(liveUrl)
  await expect(observer.getByText('Live · revision 2')).toBeVisible()
  await expect(observer.getByText('Firewood', { exact: true })).toBeVisible()
})
