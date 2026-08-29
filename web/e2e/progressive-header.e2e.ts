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

test('renders six edge-aware progressive blur layers on the header and idle navigation dock', async ({ page }) => {
  await page.goto('/#device')

  const headerBlur = page.locator('.progressive-blur--header')
  const dock = page.getByLabel('Brew navigation and preparation')
  const dockBlur = dock.locator('.progressive-blur--dock')
  await expect(headerBlur).toHaveAttribute('aria-hidden', 'true')
  await expect(headerBlur).toHaveCSS('pointer-events', 'none')
  await expect(headerBlur.locator(':scope > span')).toHaveCount(6)
  await expect(dockBlur.locator(':scope > span')).toHaveCount(6)
  await expect(headerBlur.locator(':scope > span').last()).toHaveCSS('backdrop-filter', /blur\(16px\)/)
  await expect(dockBlur.locator(':scope > span').last()).toHaveCSS('backdrop-filter', /blur\(16px\)/)
  expect(await dock.evaluate((element) => getComputedStyle(element).getPropertyValue('--progressive-blur-direction').trim())).toBe('to top')

  await page.getByRole('button', { name: 'Dark' }).click()
  await expect(page.locator('.appliance')).toHaveAttribute('data-theme', 'dark')
  await expect(dockBlur).toBeVisible()

  await page.setViewportSize({ width: 390, height: 844 })
  expect(await dock.evaluate((element) => getComputedStyle(element).getPropertyValue('--progressive-blur-direction').trim())).toBe('to bottom')

  await page.getByRole('link', { name: 'Beans' }).click()
  await expect(page).toHaveURL(/#beans$/)
  await page.locator('.settings-tab').click()
  await expect(page).toHaveURL(/#device$/)
  const prepare = page.getByRole('button', { name: 'Prepare brew' })
  await prepare.focus()
  await expect(prepare).toBeFocused()
  await prepare.press('Enter')
  await expect(page.getByRole('region', { name: 'Choose your brew' })).toBeVisible()
})
