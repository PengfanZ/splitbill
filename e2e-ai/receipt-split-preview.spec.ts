import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'

const aiPreviewURL = 'http://127.0.0.1:4184'

async function openReceiptFlow(page: Page, activityName: string) {
  await page.goto('./')
  await page.getByLabel('Display name').fill('Preview Tester')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Create an activity' }).click()
  await page.getByLabel('Activity name').fill(activityName)
  await page.getByLabel(/Add friends/).fill('Maya')
  await page.getByRole('button', { name: 'Create activity' }).click()
  await page.getByRole('button', { name: 'Add expense' }).click()
  await expect(page.getByRole('tab', { name: 'Enter manually' })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('tab', { name: 'Receipt' }).click()
  await expect(page.getByRole('heading', { name: 'Split a receipt' })).toBeVisible()
}

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

  await openReceiptFlow(page, 'Receipt preview dinner')
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

test('turns a detected subtotal gap into an assignable review item', async ({ page }) => {
  await page.route(`${aiPreviewURL}/functions/v1/parse-receipt`, route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      model: 'test-model',
      result: {
        version: 1,
        merchant: 'Receipt gap test',
        currency: 'USD',
        purchasedAt: '2026-08-23',
        items: [{
          id: 'item-1',
          name: 'Detected dishes',
          quantity: 1,
          unitPriceCents: 10_322,
          totalCents: 10_322,
          details: [],
          sourceLines: [],
          confidence: 'high',
        }],
        charges: [{
          id: 'charge-1',
          type: 'tax',
          label: 'Tax 8%',
          amountCents: 838,
          rateBasisPoints: 800,
          confidence: 'high',
        }],
        subtotalCents: 10_472,
        totalCents: 11_310,
        unresolvedLines: [],
      },
    }),
  }))

  await openReceiptFlow(page, 'Receipt gap test')
  await page.locator('input[type="file"]').nth(1).setInputFiles(path.resolve('public/og.png'))

  await expect(page.getByText('Detected items are $1.50 below the printed subtotal.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Assign dishes' })).toBeDisabled()
  await page.getByRole('button', { name: 'Add missing item · $1.50' }).click()
  await expect(page.getByLabel('Unrecognized item amount')).toHaveValue('1.50')
  await expect(page.getByText('$113.10')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Assign dishes' })).toBeEnabled()
})
