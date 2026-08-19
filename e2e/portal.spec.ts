import { test, expect } from '@playwright/test'

test('administrator can sign in and navigate modules', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: 'ISU-CAMP' })).toBeVisible()
  await expect(page).toHaveScreenshot('login.png', { animations: 'disabled' })
  await page.getByRole('button', { name: /login/i }).click()
  await expect(page).toHaveURL(/dashboard/)
  await expect(page.getByRole('heading', { name: 'Campus Overview' })).toBeVisible()
  await expect(page).toHaveScreenshot('dashboard.png', { animations: 'disabled' })
  await page.locator('.sidebar a', { hasText: 'Locations' }).click()
  await expect(page).toHaveURL(/locations/)
  await expect(page.getByRole('heading', { name: 'Campus Locations' })).toBeVisible()
  await page.locator('.sidebar a', { hasText: 'System Logs' }).click()
  await expect(page.getByRole('heading', { name: 'System Logs' })).toBeVisible()
})

test('password recovery reaches verification step', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('link', { name: /forgot password/i }).click()
  await expect(page).toHaveURL(/reset-password/)
  await page.getByRole('button', { name: /send code/i }).click()
  await expect(page.getByRole('heading', { name: /enter verification code/i })).toBeVisible()
})
