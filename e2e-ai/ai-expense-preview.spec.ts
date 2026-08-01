import { expect, test } from '@playwright/test'

test.beforeEach(async ({ context }) => {
  await context.route('https://live-sharing.test/rest/v1/rpc/record_analytics_event', route => route.fulfill({
    status: 204,
    body: '',
  }))
})

test('turns a description into a reviewable draft before the user saves it', async ({ page }) => {
  let aiRequests = 0
  await page.route('https://live-sharing.test/functions/v1/parse-expense', async route => {
    aiRequests += 1
    const request = route.request()
    expect(request.method()).toBe('POST')
    expect(request.headers().apikey).toBe('test-publishable-key')
    expect(request.postDataJSON()).toMatchObject({
      text: 'Maya paid $36 for dinner, split between Maya and me',
      currency: 'USD',
      members: [
        { id: 'me', name: 'Preview Tester' },
        { name: 'Maya' },
      ],
    })
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        result: {
          status: 'ready',
          title: 'Dinner',
          amountCents: 3_600,
          payerId: request.postDataJSON().members[1].id,
          splitMethod: 'equal',
          participantIds: request.postDataJSON().members.map((member: { id: string }) => member.id),
          exactSharesCents: [],
        },
        model: 'google/gemma-4-26b-a4b-it:free',
      }),
    })
  })

  await page.goto('./')
  await page.getByLabel('Display name').fill('Preview Tester')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Create an activity' }).click()
  await page.getByLabel('Activity name').fill('AI preview dinner')
  await page.getByLabel(/Add friends/).fill('Maya')
  await page.getByRole('button', { name: 'Create activity' }).click()

  await page.getByRole('button', { name: 'Add expense' }).click()
  await expect(page.getByRole('tab', { name: 'Describe with AI' })).toHaveAttribute('aria-selected', 'true')
  await page.getByLabel('Expense description').fill('Maya paid $36 for dinner, split between Maya and me')
  await page.getByRole('button', { name: 'Create draft' }).click()

  await expect(page.getByRole('status')).toContainText('AI draft ready')
  await expect(page.getByLabel('Description')).toHaveValue('Dinner')
  await expect(page.getByRole('spinbutton', { name: 'Amount' })).toHaveValue('36')
  await expect(page.getByRole('button', { name: 'Paid by' })).toContainText('Maya')
  await expect(page.getByRole('button', { name: 'Save expense' })).toBeVisible()
  await expect(page.getByText('Dinner', { exact: true })).toHaveCount(0)

  await page.getByRole('button', { name: 'Save expense' }).click()
  await expect(page.getByText('Dinner', { exact: true })).toBeVisible()
  await expect(page.locator('.expense-amount b')).toHaveText('$36.00')
  expect(aiRequests).toBe(1)
})
