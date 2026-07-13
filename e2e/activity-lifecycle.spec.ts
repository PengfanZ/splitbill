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
