import { expect, test } from '@playwright/test'

function relativeLuminance([red, green, blue]: number[]) {
  const channel = (value: number) => {
    const normalized = value / 255
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)
}

function contrastRatio(foreground: number[], background: number[]) {
  const [lighter, darker] = [relativeLuminance(foreground), relativeLuminance(background)].sort((left, right) => right - left)
  return (lighter + 0.05) / (darker + 0.05)
}

async function expectAccessibleLegacyNotification(page: import('@playwright/test').Page) {
  const notification = page.getByRole('status').filter({ hasText: 'Browser-saved PourOver recipes were found.' })
  await expect(notification).toBeVisible()
  const metrics = await notification.evaluate((element) => {
    const message = element.querySelector('strong')!
    const action = element.querySelector('.brew-notification__action')!
    const icon = element.querySelector('.brew-notification__icon')!
    const rgb = (value: string) => value.match(/\d+/g)!.slice(0, 3).map(Number)
    const messageStyle = getComputedStyle(message)
    const cardStyle = getComputedStyle(element)
    const messageBox = message.getBoundingClientRect()
    const cardBox = element.getBoundingClientRect()
    return {
      card: rgb(getComputedStyle(element).backgroundColor),
      message: rgb(getComputedStyle(message).color),
      action: rgb(getComputedStyle(action).backgroundColor),
      actionText: rgb(getComputedStyle(action).color),
      icon: rgb(getComputedStyle(icon).backgroundColor),
      iconForeground: rgb(getComputedStyle(icon).color),
      messageBlendMode: messageStyle.mixBlendMode,
      messageFullyVisible: messageStyle.overflowY === 'visible' && messageBox.bottom <= cardBox.bottom - Number.parseFloat(cardStyle.paddingBottom) + 1,
    }
  })

  expect(contrastRatio(metrics.message, metrics.card)).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(metrics.actionText, metrics.action)).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(metrics.iconForeground, metrics.icon)).toBeGreaterThanOrEqual(3)
  expect(metrics.messageBlendMode).toBe('normal')
  expect(metrics.messageFullyVisible).toBe(true)
}

test('moves legacy import prompt into notifications', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('pourframe.onboarding.v1', 'completed')
    localStorage.setItem('pourover.recipes.v1', '[]')
  })
  await page.goto('/#history')

  await expect(page.locator('.legacy-banner')).toHaveCount(0)
  const notification = page.getByRole('status').filter({ hasText: 'Browser-saved PourOver recipes were found.' })
  await expect(notification).toBeVisible()
  await expect(notification.getByRole('button', { name: 'Import to PourFrame' })).toBeVisible()
  await expectAccessibleLegacyNotification(page)

  await notification.getByRole('button', { name: 'Import to PourFrame' }).click()
  await expect(notification).toHaveCount(0)
})

test('keeps the legacy notification readable and untruncated on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => {
    localStorage.setItem('pourframe.onboarding.v1', 'completed')
    localStorage.setItem('pourover.recipes.v1', '[]')
  })
  await page.goto('/#history')
  await expectAccessibleLegacyNotification(page)
})

test('keeps the legacy notification readable in dark mode', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('pourframe.onboarding.v1', 'completed')
    localStorage.setItem('pourframe.theme.preference.v1', 'dark')
    localStorage.setItem('pourover.recipes.v1', '[]')
  })
  await page.goto('/#history')
  await expect(page.locator('.appliance[data-theme="dark"]')).toBeVisible()
  await expectAccessibleLegacyNotification(page)
})
