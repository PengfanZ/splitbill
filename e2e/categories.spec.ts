import { expect, test } from '@playwright/test'
import { IDENTITY_KEY } from '../src/data/identity'
import { STORAGE_KEY } from '../src/data/storage'
import { CHANGELOG_SEEN_STORAGE_KEY, LATEST_CHANGELOG_ID } from '../src/features/changelog/changelog'

test.use({ deviceScaleFactor: 2 })
for (const mobile of [false, true]) test(`categories persist without changing splits (${mobile ? 'mobile' : 'desktop'})`, async ({ context, page }) => {
  const categoryEvents: Record<string, unknown>[] = []
  await context.route('**/rest/v1/rpc/record_analytics_event', route => {
    const body = route.request().postDataJSON()
    if (body.p_event_name.startsWith('category_')) categoryEvents.push(body)
    return route.fulfill({ status: 204, body: '' })
  })
  await context.addInitScript(({ identityKey, storageKey, seenKey, seenId }) => {
    if (localStorage.getItem(identityKey)) return
    localStorage.setItem(identityKey, JSON.stringify({ id: 'me', name: 'Maya', initials: 'M', color: '#ead1b9' }))
    localStorage.setItem(seenKey, seenId)
    localStorage.setItem('tally:locale:v1', 'en')
    localStorage.setItem(storageKey, JSON.stringify({
      groups: [{ id: 'trip', name: 'Kyoto weekend', emoji: '✦', memberIds: ['me'] }], friends: [], selectedGroupId: 'trip',
      expenses: [{ id: 'dinner', groupId: 'trip', title: 'Dinner', amount: 120, payerId: 'me', splitMethod: 'equal', shares: { me: 120 }, createdAt: '2026-09-22T12:00:00Z' }],
    }))
  }, { identityKey: IDENTITY_KEY, storageKey: STORAGE_KEY, seenKey: CHANGELOG_SEEN_STORAGE_KEY, seenId: LATEST_CHANGELOG_ID })
  if (mobile) await page.setViewportSize({ width: 390, height: 844 })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('./')
  await page.getByRole('button', { name: 'Activity options', exact: true }).click()
  await page.getByRole('button', { name: 'Manage categories', exact: true }).click()
  await page.getByRole('button', { name: 'Create category', exact: true }).click()
  await page.getByLabel('Category name').fill('Coffee stops')
  await page.getByRole('button', { name: 'Color #a78ab8', exact: true }).click()
  await page.getByRole('button', { name: 'Save category', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Manage categories' })).toBeVisible()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Edit Dinner', exact: true }).click()
  await page.getByRole('button', { name: 'Category (optional)', exact: true }).click()
  if (process.env.TALLY_CAPTURE_CATEGORY_UX) await page.screenshot({ path: `/tmp/tally-category-dropdown-${mobile ? 'mobile' : 'desktop'}.png`, animations: 'disabled' })
  await page.locator('.select-menu-popover').getByRole('button', { name: 'Manage categories', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Manage categories' })).toBeVisible()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByLabel('Description')).toHaveValue('Dinner')
  await page.getByRole('button', { name: 'Category (optional)', exact: true }).click()
  await page.getByRole('option', { name: 'Coffee stops', exact: true }).click()
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await page.reload()
  await expect(page.locator('.expense-category-label')).toHaveText('Coffee stops')
  await expect(page.locator('.expense-category-label')).toHaveCSS('--category-color', '#a78ab8')
  await page.getByRole('tab', { name: 'By category', exact: true }).click()
  await expect(page.getByRole('region', { name: 'By category' })).toContainText('$120.00')
  await expect(page.locator('vite-error-overlay')).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  if (process.env.TALLY_CAPTURE_CATEGORY_UX) await page.screenshot({ path: `/tmp/tally-categories-implemented-${mobile ? 'mobile' : 'desktop'}.png`, fullPage: true, animations: 'disabled' })
  await page.getByRole('button', { name: 'Manage categories', exact: true }).click()
  await expect(page.getByText('Default for uncategorized expenses')).toBeVisible()
  if (process.env.TALLY_CAPTURE_CATEGORY_UX) await page.screenshot({ path: `/tmp/tally-category-manager-${mobile ? 'mobile' : 'desktop'}.png`, animations: 'disabled' })
  await page.getByRole('button', { name: 'Delete category Coffee stops', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('1 expenses will move to General')
  await page.getByRole('button', { name: 'Delete category', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Manage categories' })).toBeVisible()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.reload()
  // General is the default, so the list shows no category chip for it.
  await expect(page.getByRole('button', { name: 'Edit Dinner', exact: true })).toBeVisible()
  await expect(page.locator('.expense-category-label')).toHaveCount(0)
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).expenses[0], STORAGE_KEY)
  expect(saved.amount).toBe(120)
  expect(saved.shares).toEqual({ me: 120 })
  await expect.poll(() => categoryEvents.map(event => event.p_event_name)).toEqual(['category_created', 'category_selected', 'category_summary_opened', 'category_deleted'])
  for (const event of categoryEvents) {
    expect(event).toMatchObject({ p_surface: 'local', p_locale: 'en', p_currency: null })
    expect(Object.keys(event).sort()).toEqual(['p_currency', 'p_event_name', 'p_locale', 'p_session_token', 'p_surface'])
  }
  await page.evaluate(({ storageKey, identityKey }) => {
    const state = JSON.parse(localStorage.getItem(storageKey)!)
    state.expenses[0].title = 'Dinner with friends after a long day exploring Kyoto 京都旅行结束后的聚餐和甜点'
    state.expenses[0].categoryId = 'food'
    localStorage.setItem(storageKey, JSON.stringify(state))
    const identity = JSON.parse(localStorage.getItem(identityKey)!)
    identity.name = 'Alexandra Chen 小陈'
    localStorage.setItem(identityKey, JSON.stringify(identity))
  }, { storageKey: STORAGE_KEY, identityKey: IDENTITY_KEY })
  await page.reload()
  const row = page.locator('.expense-entry').first()
  await expect(row).toContainText('京都旅行结束后的聚餐和甜点')
  await expect(row.locator('.row-copy b')).toHaveCSS('white-space', 'normal')
  expect(await row.evaluate(element => [...element.querySelectorAll('.row-copy, .row-copy b, .row-copy small, .expense-meta-line')].every(item => item.scrollWidth <= item.clientWidth + 1))).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  if (process.env.TALLY_CAPTURE_CATEGORY_UX) await row.screenshot({ path: `/tmp/tally-expense-row-${mobile ? 'mobile' : 'desktop'}.png`, animations: 'disabled' })
  await expect(row).toHaveAccessibleName(/^Edit Dinner/)
  await row.click()
  await expect(page.getByLabel('Description')).toHaveValue('Dinner with friends after a long day exploring Kyoto 京都旅行结束后的聚餐和甜点')
  expect(errors).toEqual([])
})
