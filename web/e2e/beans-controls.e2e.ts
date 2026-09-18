import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pourframe.onboarding.v1', 'completed'))
  await page.goto('/#beans')
})

test('places Add bag above the desktop Beans toolbar', async ({ page }) => {
  const workspace = page.locator('.coffee-library-workspace')
  const header = workspace.locator('.library-workspace__header')
  const controls = workspace.locator('.bean-library-controls')

  await expect(header.getByRole('button', { name: 'Add bag' })).toHaveCount(0)
  await expect(controls.getByRole('button', { name: 'Add bag' })).toBeVisible()
  await expect(controls.locator('.bean-library-controls__desktop')).toBeVisible()
  await expect(controls.getByRole('button', { name: 'Show bag controls' })).toBeHidden()
})

test('moves Beans controls into the mobile overflow menu', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const controls = page.locator('.bean-library-controls')
  const trigger = controls.getByRole('button', { name: 'Show bag controls' })

  await expect(controls.locator('.bean-library-controls__desktop')).toBeHidden()
  await expect(trigger).toBeVisible()
  await trigger.click()
  const menu = page.getByRole('dialog', { name: 'Bag controls' })
  await expect(menu).toBeVisible()
  await menu.getByRole('button', { name: 'List' }).click()
  await expect(menu).toBeHidden()
  await expect(page.locator('.bag-collection--list')).toHaveCount(2)
  await expect(trigger).toBeFocused()
})
