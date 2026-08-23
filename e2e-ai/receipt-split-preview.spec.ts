import { expect, test } from '@playwright/test'
import path from 'node:path'

const aiPreviewURL = 'http://127.0.0.1:4184'

test.beforeEach(async ({ context }) => {
  await context.route(`${aiPreviewURL}/rest/v1/rpc/record_analytics_event`, route => route.fulfill({
    status: 204,
    body: '',
  }))
})

test('scans, reviews, assigns, and saves a receipt on mobile', async ({ page }) => {
  const analytics: string[] = []
  await page.unroute(`${aiPreviewURL}/rest/v1/rpc/record_analytics_event`)
  await page.route(`${aiPreviewURL}/rest/v1/rpc/record_analytics_event`, route => {
    analytics.push(route.request().postDataJSON().p_event_name)
    return route.fulfill({ status: 204, body: '' })
  })

  await page.goto('./')
  await page.getByLabel('Display name').fill('Preview Tester')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Create an activity' }).click()
  await page.getByLabel('Activity name').fill('Receipt preview dinner')
  await page.getByLabel(/Add friends/).fill('Maya')
  await page.getByRole('button', { name: 'Create activity' }).click()
  await page.getByRole('button', { name: 'Add expense' }).click()

  await expect(page.getByRole('tab', { name: 'Enter manually' })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('tab', { name: 'Receipt' }).click()
  await expect(page.getByRole('heading', { name: 'Split a receipt' })).toBeVisible()
  await page.locator('input[type="file"]').nth(1).setInputFiles(path.resolve('public/og.png'))

  await expect(page.getByText('Review the receipt')).toBeVisible()
  await expect(page.getByLabel('Ramen amount')).toHaveValue('20.00')
  await page.getByRole('button', { name: 'Assign dishes' }).click()
  await page.getByRole('button', { name: 'Assign Ramen to Preview Tester' }).click()
  await page.getByRole('button', { name: 'Assign Bao to Maya' }).click()
  await page.getByRole('button', { name: 'Review split' }).click()

  await expect(page.getByLabel('Expense name')).toHaveValue('Bao Button')
  await expect(page.getByText('$34.56')).toBeVisible()
  await page.getByRole('button', { name: 'Add receipt expense' }).click()
  await expect(page.getByText('Bao Button', { exact: true })).toBeVisible()
  await expect(page.locator('.expense-amount b')).toHaveText('$34.56')
  await expect.poll(() => analytics).toEqual(expect.arrayContaining([
    'expense_input_receipt_selected',
    'ai_receipt_requested',
    'ai_receipt_ready',
    'ai_receipt_confirmed',
  ]))
})
