import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pourframe.onboarding.v1', 'completed'))
})

test('keeps bean editing modal, focus, and dirty dismissal accessible on iPhone size', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#beans')

  const trigger = page.getByRole('button', { name: 'Add bag' })
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: 'Add coffee bag' })
  await expect(dialog).toHaveAttribute('aria-modal', 'true')
  await expect(page.locator('.appliance')).toHaveAttribute('inert', '')
  await expect(dialog.getByRole('combobox', { name: 'Roastery' })).toBeFocused()

  await dialog.getByRole('combobox', { name: 'Roastery' }).fill('Test roastery')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  const confirmation = page.getByRole('alertdialog', { name: 'Unsaved changes' })
  await expect(confirmation).toBeVisible()
  await confirmation.getByRole('button', { name: 'Continue editing' }).click()
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await page.getByRole('alertdialog', { name: 'Unsaved changes' }).getByRole('button', { name: 'Discard' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(trigger).toBeFocused()
})

test('keeps short-height brew selection bounded and keyboard-addressable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 390 })
  await page.goto('/#history')
  await page.locator('.history-workspace').getByRole('button', { name: 'Prepare brew' }).click()

  const dialog = page.getByRole('dialog', { name: 'Choose your brew' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveAttribute('aria-modal', 'true')
  await expect(dialog.getByRole('radiogroup', { name: 'Coffee beans' })).toBeVisible()
  await expect(dialog.getByRole('radiogroup', { name: 'Brew recipes' })).toBeVisible()
  await dialog.getByRole('radio').first().focus()
  await expect(dialog.getByRole('radio').first()).toBeFocused()
  const bounds = await dialog.boundingBox()
  expect(bounds?.height ?? Infinity).toBeLessThanOrEqual(390)
})
