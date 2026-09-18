import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('pourframe.onboarding.v1', 'completed')
    localStorage.removeItem('pourframe.recipes.view.v1')
    localStorage.removeItem('pourframe.recipes.serve.v1')
    localStorage.removeItem('pourframe.recipes.visibility.v1')
    localStorage.removeItem('pourframe.recipes.sort.v1')
  })
  await page.goto('/#recipes')
})

test('places Recipe actions above the desktop toolbar', async ({ page }) => {
  const workspace = page.locator('.recipe-library-workspace')
  const header = workspace.locator('.library-workspace__header')
  const controls = workspace.locator('.recipe-library-controls')

  await expect(header.getByRole('button', { name: /import|new recipe/i })).toHaveCount(0)
  await expect(controls.getByRole('button', { name: 'Import' })).toBeVisible()
  await expect(controls.getByRole('button', { name: 'New recipe' })).toBeVisible()
  await expect(controls.locator('.recipe-library-controls__desktop')).toBeVisible()
  await expect(controls.getByRole('button', { name: 'Show recipe controls' })).toBeHidden()
  await expect(workspace.getByText('Starred', { exact: true })).toHaveCount(0)
  await expect(workspace.getByText('Last brewed', { exact: true })).toHaveCount(0)
})

test('uses the mobile menu for Recipe controls and restores focus on dismissal', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const controls = page.locator('.recipe-library-controls')
  const trigger = controls.getByRole('button', { name: 'Show recipe controls' })

  await expect(controls.locator('.recipe-library-controls__desktop')).toBeHidden()
  await expect(controls.getByRole('button', { name: 'New recipe' })).toBeVisible()
  await trigger.click()
  const menu = page.getByRole('dialog', { name: 'Recipe controls' })
  await expect(menu.getByRole('button', { name: 'Import recipe' })).toBeVisible()
  await menu.getByRole('button', { name: 'List' }).click()
  await expect(menu).toBeHidden()
  await expect(page.locator('.recipe-collection--list')).toHaveCount(1)
  await expect(trigger).toBeFocused()

  await trigger.click()
  await menu.getByLabel('Show brews').getByRole('button', { name: 'Iced' }).click()
  await expect(menu).toBeHidden()
  await expect(trigger).toBeFocused()

  await trigger.click()
  await menu.getByLabel('Show recipes').selectOption('starred')
  await expect(menu).toBeHidden()
  await expect(trigger).toBeFocused()

  await trigger.click()
  await menu.getByLabel('Sort recipes').selectOption('updated')
  await expect(menu).toBeHidden()
  await expect(trigger).toBeFocused()

  await trigger.click()
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect(trigger).toBeFocused()
})
