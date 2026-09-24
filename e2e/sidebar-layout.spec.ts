import { expect, test } from '@playwright/test'
import { IDENTITY_KEY } from '../src/data/identity'
import { STORAGE_KEY } from '../src/data/storage'
import { CHANGELOG_SEEN_STORAGE_KEY, LATEST_CHANGELOG_ID } from '../src/features/changelog/changelog'

test('mobile sidebar truncates long activity names instead of overlapping row actions', async ({ context, page }) => {
  await context.addInitScript(({ identityKey, storageKey, seenKey, seenId }) => {
    localStorage.setItem(identityKey, JSON.stringify({ id: 'me', name: 'Maya', initials: 'M', color: '#ead1b9' }))
    localStorage.setItem(seenKey, seenId)
    localStorage.setItem('tally:locale:v1', 'en')
    localStorage.setItem(storageKey, JSON.stringify({
      groups: [
        { id: 'short', name: 'Offline', emoji: '⌂', memberIds: ['me'] },
        { id: 'long', name: 'Afternoon badminton with the whole club', emoji: '✈️', memberIds: ['me'] },
      ],
      friends: [], expenses: [], selectedGroupId: 'short',
    }))
  }, { identityKey: IDENTITY_KEY, storageKey: STORAGE_KEY, seenKey: CHANGELOG_SEEN_STORAGE_KEY, seenId: LATEST_CHANGELOG_ID })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('./')
  await page.getByRole('button', { name: 'Open navigation' }).click()

  for (const name of ['Offline', 'Afternoon badminton with the whole club']) {
    const select = page.getByRole('button', { name: `Open ${name} activity` })
    await expect(select).toBeVisible()
    const row = select.locator('xpath=..')
    const [text, subtitle, chevron, remove] = await Promise.all([
      select.locator('b').boundingBox(),
      select.locator('small').boundingBox(),
      select.locator('svg').boundingBox(),
      row.locator('.group-delete').boundingBox(),
    ])
    expect(text!.x + text!.width).toBeLessThanOrEqual(chevron!.x)
    expect(chevron!.x + chevron!.width).toBeLessThanOrEqual(remove!.x)
    // The "1 person" subtitle stays on a single line.
    expect(subtitle!.height).toBeLessThan(20)
  }
})
