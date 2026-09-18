import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pourframe.onboarding.v1', 'completed'))
})

test('keeps the header fixed while the title stays compact until the page returns to the top', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#device')

  const header = page.locator('.appliance-header')
  const title = header.locator('.appliance-header__title')
  await expect(header).toHaveAttribute('data-compact', 'false')
  await expect(header).toHaveCSS('position', 'sticky')
  await expect(title).toHaveCSS('font-size', '32px')

  await page.evaluate(() => window.scrollTo(0, 360))
  await expect(header).toHaveAttribute('data-compact', 'true')
  await expect(title).toHaveCSS('font-size', '22.4px')
  expect((await header.boundingBox())?.y).toBe(0)

  await page.evaluate(() => window.scrollTo(0, 120))
  await expect(header).toHaveAttribute('data-compact', 'true')
  await expect(title).toHaveCSS('font-size', '22.4px')

  await page.evaluate(() => window.scrollTo(0, 0))
  await expect(header).toHaveAttribute('data-compact', 'false')
  await expect(title).toHaveCSS('font-size', '32px')
})
