import { expect, test, type Page } from '@playwright/test'

test.beforeEach(async ({ context }) => {
  await context.route('https://live-sharing.test/rest/v1/rpc/record_analytics_event', route => route.fulfill({
    status: 204,
    body: '',
  }))
})

async function createPreviewActivity(page: Page) {
  await page.goto('./')
  await page.getByLabel('Display name').fill('Preview Tester')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Create an activity' }).click()
  await page.getByLabel('Activity name').fill('AI preview dinner')
  await page.getByLabel(/Add friends/).fill('Maya')
  await page.getByRole('button', { name: 'Create activity' }).click()
  await page.getByRole('button', { name: 'Add expense' }).click()
}

test('clarifies an incomplete description locally, then sends structured follow-up context', async ({ page }) => {
  let aiRequests = 0
  await page.route('https://live-sharing.test/functions/v1/parse-expense', async route => {
    aiRequests += 1
    const body = route.request().postDataJSON()
    expect(body).toMatchObject({
      text: 'dinner',
      clarification: {
        question: 'Please add the total amount, who paid, and who should be included in the split.',
        answer: 'Maya paid $30 and split it with me',
      },
    })
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        result: {
          status: 'ready',
          title: 'Dinner',
          amountCents: 3_000,
          payerId: body.members[1].id,
          splitMethod: 'equal',
          participantIds: body.members.map((member: { id: string }) => member.id),
          exactSharesCents: [],
        },
      }),
    })
  })

  await createPreviewActivity(page)
  await page.getByLabel('Expense description').fill('dinner')
  await page.getByRole('button', { name: 'Create draft' }).click()

  await expect(page.getByRole('status')).toContainText(
    'Please add the total amount, who paid, and who should be included in the split.',
  )
  await expect(page.getByLabel('Your answer')).toBeEditable()
  expect(aiRequests).toBe(0)

  await page.getByLabel('Your answer').fill('Maya paid $30 and split it with me')
  await page.getByRole('button', { name: 'Update draft' }).click()
  await expect(page.getByRole('status')).toContainText('AI draft ready')
  expect(aiRequests).toBe(1)
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

  await createPreviewActivity(page)
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

test('sends a substantive non-English description to the model without an English-only gate', async ({ page }) => {
  let aiRequests = 0
  await page.route('https://live-sharing.test/functions/v1/parse-expense', async route => {
    aiRequests += 1
    const body = route.request().postDataJSON()
    expect(body.text).toBe('Maya pagó 36 € por la cena y lo dividimos entre Maya y yo')
    expect(body.locale).toBe('en')
    expect(body).not.toHaveProperty('clarification')
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        result: {
          status: 'ready',
          title: 'Cena',
          amountCents: 3_600,
          payerId: body.members[1].id,
          splitMethod: 'equal',
          participantIds: body.members.map((member: { id: string }) => member.id),
          exactSharesCents: [],
        },
      }),
    })
  })

  await createPreviewActivity(page)
  await page.getByLabel('Expense description').fill('Maya pagó 36 € por la cena y lo dividimos entre Maya y yo')
  await page.getByRole('button', { name: 'Create draft' }).click()

  await expect(page.getByRole('status')).toContainText('AI draft ready')
  await expect(page.getByLabel('Description')).toHaveValue('Cena')
  expect(aiRequests).toBe(1)
})

test('explains a legacy unsafe-model response without calling the model unavailable', async ({ page }) => {
  await page.route('https://live-sharing.test/functions/v1/parse-expense', route => route.fulfill({
    status: 502,
    contentType: 'application/json',
    body: JSON.stringify({
      code: 'invalid_model_response',
      message: 'The AI response could not be safely converted into an expense.',
    }),
  }))

  await createPreviewActivity(page)
  await page.getByLabel('Expense description').fill('Something happened with dinner and the group')
  await page.getByRole('button', { name: 'Create draft' }).click()

  const error = page.getByRole('alert')
  await expect(error).toContainText('Tally could not turn that into a reliable draft.')
  await expect(error).not.toContainText('unavailable')
})
