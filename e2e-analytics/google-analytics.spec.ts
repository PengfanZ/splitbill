import { expect, test } from '@playwright/test'

test('mirrors app interactions without leaking names, amounts or URL capabilities', async ({ page }) => {
  const errors: string[] = []
  const googleRequests: string[] = []
  const events: Record<string, unknown>[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.route('https://www.googletagmanager.com/**', async route => {
    googleRequests.push(route.request().url())
    expect(route.request().headers().referer).toBeUndefined()
    // Exercise the standard gtag argument-object queue, without sending test traffic to Google.
    await route.fulfill({ contentType: 'application/javascript', body: `
      window.gaTestCommands = [];
      const queue = window.tallyGoogleAnalytics;
      const record = command => window.gaTestCommands.push(Array.from(command));
      queue.forEach(record);
      queue.push = command => { record(command); return 0; };
    ` })
  })
  await page.route('**/rest/v1/rpc/record_analytics_event', async route => {
    events.push(route.request().postDataJSON())
    await route.fulfill({ status: 204, body: '' })
  })
  await page.goto('./?private=SensitiveQuery#private=SensitiveFragment')
  await expect(page).toHaveTitle('Tally — Group Expense Splitter')
  await page.getByLabel('Display name').fill('Private Person')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Create an activity' }).click()
  await page.getByLabel('Activity name').fill('Secret weekend')
  await page.getByRole('button', { name: 'Create activity' }).click()
  await page.getByRole('button', { name: 'Add expense' }).click()
  await page.getByLabel('Description').fill('Private dinner')
  await page.getByRole('spinbutton', { name: 'Amount' }).fill('42.37')
  await page.getByRole('button', { name: 'Save expense' }).click()
  await expect(page.getByText('Private dinner', { exact: true })).toBeVisible()
  const commands = await page.evaluate(() => (window as unknown as { gaTestCommands: unknown[][] }).gaTestCommands)
  const gaEvents = commands.filter(command => command[0] === 'event')
  // "Private dinner" keeps its suggested Food & drinks category, which is mirrored like every allowlisted event.
  expect(gaEvents.map(command => command[1])).toEqual(['page_view', 'app_opened', 'activity_created', 'expense_added', 'category_suggestion_kept'])
  expect(events.map(event => event.p_event_name)).toEqual(['app_opened', 'activity_created', 'expense_added', 'category_suggestion_kept'])
  expect(JSON.stringify(commands)).not.toMatch(/Private|Secret|Sensitive|42\.37|#live=/)
  expect(gaEvents.every(command => (command[2] as { page_location: string }).page_location === 'http://127.0.0.1:4175/splitbill/')).toBe(true)
  expect(googleRequests).toHaveLength(1)
  expect(errors).toEqual([])
})

test('a blocked Google tag cannot break local expense entry', async ({ page }) => {
  await page.route('https://www.googletagmanager.com/**', route => route.abort('blockedbyclient'))
  await page.route('**/rest/v1/rpc/record_analytics_event', route => route.fulfill({ status: 204, body: '' }))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('./')
  await page.getByLabel('Display name').fill('Alex')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Create an activity' }).click()
  await page.getByLabel('Activity name').fill('Weekend')
  await page.getByRole('button', { name: 'Create activity' }).click()
  await page.getByRole('button', { name: 'Add expense' }).click()
  await page.getByLabel('Description').fill('Dinner')
  await page.getByRole('spinbutton', { name: 'Amount' }).fill('25')
  await page.getByRole('button', { name: 'Save expense' }).click()
  await expect(page.getByText('Dinner', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByText('Dinner', { exact: true })).toBeVisible()
})
