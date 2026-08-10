import { expect, test } from '@playwright/test'

test('blocks clickjacking while allowing the user to open Tally directly', async ({ page }) => {
  await page.goto('/')
  const appUrl = page.url()

  await page.setContent(
    `
      <main>
        <h1>Embedding site</h1>
        <iframe title="Embedded Tally" src="${appUrl}"></iframe>
      </main>
    `,
    { waitUntil: 'domcontentloaded' },
  )

  const embeddedApp = page.frameLocator('iframe[title="Embedded Tally"]')
  await expect(embeddedApp.getByRole('heading', { name: 'Open Tally directly' })).toBeVisible()
  await expect(embeddedApp.getByText('Tally cannot run inside another website')).toBeVisible()
  await expect(embeddedApp.getByRole('button')).toHaveCount(0)

  await embeddedApp.getByRole('link', { name: 'Open Tally' }).click()
  await expect(page).toHaveURL(appUrl)
  await expect(page.locator('#root')).not.toContainText('Tally cannot run inside another website')
})
