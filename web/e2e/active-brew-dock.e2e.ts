import { expect, test } from '@playwright/test'

async function startMockBrew(page: import('@playwright/test').Page) {
  await page.addInitScript(() => localStorage.setItem('pourframe.onboarding.v1', 'completed'))
  await page.goto('/#history')
  await page.locator('.history-workspace').getByRole('button', { name: 'Prepare brew' }).click()
  await page.getByRole('dialog', { name: 'Choose your brew' }).getByRole('button', { name: 'Prepare brew' }).click()
  await page.getByText('Dry coffee and dripper are positioned on the upper scale.').click()
  await page.getByText('The empty carafe is positioned on the lower scale.').click()
  await page.getByRole('button', { name: 'Tare and prepare' }).click()
  await page.getByRole('button', { name: 'Start brew' }).click()
  expect(await page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false)
  await expect(page.getByRole('button', { name: 'Enter full-screen brew summary' })).toBeVisible()
  await page.getByRole('button', { name: /Exit (full-screen brew summary|brew focus view)/ }).click()
}

test('keeps active brew navigation and controls available outside focus view', async ({ page }) => {
  await startMockBrew(page)
  const dock = page.getByLabel('Current brew status')
  await expect(dock).toBeVisible()
  await expect(page.getByLabel('Brew navigation and preparation').getByRole('button', { name: 'Prepare brew' })).toBeDisabled()
  await page.getByRole('link', { name: 'Beans' }).click()
  await expect(dock).toBeVisible()
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await expect(dock).toBeVisible()
  await expect(dock).toHaveCSS('backdrop-filter', /blur/)
  await page.getByRole('button', { name: 'Pause brew' }).click()
  await expect(page.getByRole('button', { name: 'Resume brew' })).toBeVisible()
  await page.getByRole('button', { name: 'End and save brew' }).click()
  await expect(page.getByRole('alertdialog', { name: 'Save this brew now?' })).toBeVisible()
  await page.getByRole('button', { name: 'Keep brewing' }).click()
  await expect(dock).toBeVisible()
})

test('mobile dock expands upward above the bottom navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await startMockBrew(page)
  const dock = page.getByLabel('Current brew status')
  await page.getByRole('button', { name: 'Expand brew status' }).click()
  await expect(dock.locator('.active-brew-dock__details')).toBeVisible()
  const dockBox = await dock.boundingBox()
  const navBox = await page.getByLabel('Brew navigation and preparation').boundingBox()
  expect(dockBox?.y).toBeLessThan((navBox?.y ?? 0))
})
