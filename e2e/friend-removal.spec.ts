import { expect, test, type BrowserContext } from '@playwright/test'
import { LATEST_CHANGELOG_ID, CHANGELOG_SEEN_STORAGE_KEY } from '../src/features/changelog/changelog'
import { IDENTITY_KEY } from '../src/data/identity'
import { STORAGE_KEY } from '../src/data/storage'
import { createSharedActivity, type SharedActivity } from '../src/features/sharing/sharedActivity'
import type { Expense } from '../src/domain/models'

const me = { id: 'me', name: 'Alex', initials: 'A', color: '#ead1b9' }
const maya = { id: 'maya', name: 'Maya', initials: 'M', color: '#d6e8dc' }
const sam = { id: 'sam', name: 'Sam', initials: 'S', color: '#f6d5bd' }
const group = { id: 'weekend', name: 'Weekend in the city', emoji: '☀', memberIds: ['me', 'maya', 'sam'] }
const dinner: Expense = { id: 'dinner', groupId: group.id, title: 'Friday dinner', amount: 84, payerId: 'me', splitMethod: 'equal', shares: { me: 42, maya: 42 }, createdAt: '2026-09-09T12:00:00Z' }
const state = { groups: [group], friends: [maya, sam], expenses: [dinner], selectedGroupId: group.id }

test.use({ deviceScaleFactor: 2 })

async function prepare(context: BrowserContext, locale = 'en') {
  await context.addInitScript(({ identityKey, storageKey, changelogKey, changelogId, me, state, locale }) => {
    if (!localStorage.getItem(identityKey)) {
      localStorage.setItem(identityKey, JSON.stringify(me))
      localStorage.setItem(storageKey, JSON.stringify(state))
      localStorage.setItem(changelogKey, changelogId)
      localStorage.setItem('tally:locale:v1', locale)
    }
  }, { identityKey: IDENTITY_KEY, storageKey: STORAGE_KEY, changelogKey: CHANGELOG_SEEN_STORAGE_KEY, changelogId: LATEST_CHANGELOG_ID, me, state, locale })
  await context.route('**/rest/v1/rpc/record_analytics_event', route => route.fulfill({ status: 204, body: '' }))
}

test('mobile removal is clear, cancellable, persistent, and protects expense history', async ({ page, context }) => {
  await prepare(context)
  await page.setViewportSize({ width: 390, height: 844 })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto('./')
  await expect(page).toHaveTitle(/Tally/)
  await expect(page.locator('vite-error-overlay')).toHaveCount(0)
  await page.getByRole('button', { name: 'Remove Sam from activity' }).click()
  let dialog = page.getByRole('dialog', { name: 'Remove Sam?' })
  await expect(dialog).toContainText('Only this activity changes')
  await dialog.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)))
  const bounds = await dialog.boundingBox()
  expect(bounds!.x).toBeGreaterThanOrEqual(12)
  expect(bounds!.y).toBeGreaterThanOrEqual(12)
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(832)
  if (process.env.TALLY_CAPTURE_FRIEND_UX) await page.screenshot({ path: '/tmp/tally-remove-friend-mobile.png', scale: 'device' })
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('button', { name: 'Remove Sam from activity' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Remove Sam from activity' })).toBeFocused()
  await page.getByRole('button', { name: 'Remove Sam from activity' }).click()
  await dialog.getByRole('button', { name: 'Remove friend' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('status')).toContainText('Sam was removed')
  await page.reload()
  await expect(page.getByRole('button', { name: 'Remove Sam from activity' })).toHaveCount(0)
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).expenses, STORAGE_KEY)).toEqual([dinner])
  await page.getByRole('button', { name: 'Remove Maya from activity' }).click()
  dialog = page.getByRole('dialog', { name: 'Keep the history intact' })
  await expect(dialog).toContainText('Friday dinner')
  await expect(dialog.getByRole('button', { name: 'Remove friend' })).toHaveCount(0)
  await dialog.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)))
  if (process.env.TALLY_CAPTURE_FRIEND_UX) await page.screenshot({ path: '/tmp/tally-remove-friend-history.png', scale: 'device' })
  await dialog.getByRole('button', { name: 'Close', exact: true }).last().click()
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect(page.getByRole('heading', { name: group.name })).toBeVisible()
  if (process.env.TALLY_CAPTURE_FRIEND_UX) await page.screenshot({ path: '/tmp/tally-remove-friend-after.png', scale: 'device' })
  expect(errors).toEqual([])
})

test('live friend removal syncs to another browser without changing expenses', async ({ page, context, browser }) => {
  const code = 'A1B2C3D4E5'
  const token = 'a'.repeat(64)
  let snapshot: SharedActivity = createSharedActivity(group, [me, maya, sam], [dinner])
  let revision = 1
  const setup = async (target: BrowserContext) => {
    await prepare(target)
    await target.route('**/rest/v1/rpc/*shared_activity*', async route => {
      const request = route.request().postDataJSON()
      const fn = new URL(route.request().url()).pathname.split('/').at(-1)
      let conflicted = false
      if (fn === 'update_shared_activity_v3') {
        conflicted = request.p_expected_revision !== revision
        if (!conflicted) { snapshot = request.p_snapshot; revision++ }
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ code, snapshot, revision, updated_at: '2026-09-09T13:00:00Z', conflicted }]) })
    })
  }
  await setup(context)
  const otherContext = await browser.newContext()
  try {
    await setup(otherContext)
    const other = await otherContext.newPage()
    const url = `./#live=${code}.${token}`
    await page.goto(url)
    await other.goto(url)
    await expect(other.getByRole('button', { name: 'Remove Sam from activity' })).toBeVisible()
    await page.getByRole('button', { name: 'Remove Sam from activity' }).click()
    await expect(page.getByRole('dialog')).toContainText('does not revoke access')
    await page.getByRole('button', { name: 'Remove friend' }).click()
    await expect(page.getByText('Live · revision 2')).toBeVisible()
    await other.reload()
    await expect(other.getByText('Live · revision 2')).toBeVisible()
    await expect(other.getByRole('button', { name: 'Remove Sam from activity' })).toHaveCount(0)
    expect(snapshot.expenses).toEqual([dinner])
    await other.getByRole('button', { name: 'Remove Maya from activity' }).click()
    await expect(other.getByRole('dialog', { name: 'Keep the history intact' })).toBeVisible()
    expect(revision).toBe(2)
  } finally { await otherContext.close() }
})

test('friend removal uses Chinese copy and dark-theme surfaces', async ({ page, context }) => {
  await prepare(context, 'zh-CN')
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('./')
  await page.getByRole('button', { name: '从活动中移除Sam' }).click()
  await expect(page.getByRole('dialog', { name: '移除Sam？' })).toContainText('只影响此活动')
  await page.getByRole('dialog').evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)))
  if (process.env.TALLY_CAPTURE_FRIEND_UX) await page.screenshot({ path: '/tmp/tally-remove-friend-chinese-dark.png', scale: 'device' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('button', { name: '移除朋友', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('已从此活动中移除Sam')
})
