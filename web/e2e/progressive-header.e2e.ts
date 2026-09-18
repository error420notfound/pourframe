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

test('renders the ten-layer dark header material while keeping the idle navigation dock at six layers', async ({ page }, testInfo) => {
  await page.goto('/#device')

  const header = page.locator('.appliance-header')
  const title = header.locator('.appliance-header__title')
  const headerBlur = page.locator('.progressive-blur--header')
  const dock = page.getByLabel('Brew navigation and preparation')
  const dockStack = page.locator('.brew-dock-stack')
  const dockBlur = dockStack.locator('.progressive-blur--dock-backdrop')
  await expect(headerBlur).toHaveAttribute('aria-hidden', 'true')
  await expect(headerBlur).toHaveCSS('pointer-events', 'none')
  await expect(headerBlur.locator(':scope > span')).toHaveCount(10)
  await expect(dock.locator('.progressive-blur')).toHaveCount(0)
  await expect(dockBlur.locator(':scope > span')).toHaveCount(6)
  await expect(headerBlur.locator(':scope > span').first()).toHaveCSS('backdrop-filter', /blur\(0px\)/)
  await expect(headerBlur.locator(':scope > span').last()).toHaveCSS('backdrop-filter', /blur\(17px\)/)
  await expect(dockBlur.locator(':scope > span').last()).toHaveCSS('backdrop-filter', /blur\(16px\)/)
  expect(await headerBlur.evaluate((element) => getComputedStyle(element).getPropertyValue('--progressive-blur-direction').trim())).toBe('to bottom')
  expect(await dockStack.evaluate((element) => getComputedStyle(element).getPropertyValue('--progressive-blur-direction').trim())).toBe('to bottom')
  expect(await dock.evaluate((element) => getComputedStyle(element).zIndex)).toBe('1')
  expect(await dockBlur.evaluate((element) => getComputedStyle(element).zIndex)).toBe('0')

  await page.getByRole('button', { name: 'Dark' }).click()
  await expect(page.locator('.appliance')).toHaveAttribute('data-theme', 'dark')
  await expect(dockBlur).toBeVisible()
  await expect(headerBlur.locator(':scope > span').first()).toHaveCSS('background-color', 'rgba(0, 0, 0, 0.16)')
  await expect(headerBlur.locator(':scope > span').last()).toHaveCSS('mix-blend-mode', 'normal')
  expect(await headerBlur.locator(':scope > span').first().evaluate((element) => getComputedStyle(element).getPropertyValue('--progressive-blur-direction').trim())).toBe('to bottom')

  for (const [name, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }] ] as const) {
    await page.setViewportSize(viewport)
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await expect(header).toBeVisible()
    await expect(title).toBeVisible()
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath(`progressive-header-dark-${name}.png`) })
  }

  await page.setViewportSize({ width: 390, height: 844 })
  expect(await dockStack.evaluate((element) => getComputedStyle(element).getPropertyValue('--progressive-blur-direction').trim())).toBe('to bottom')

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
