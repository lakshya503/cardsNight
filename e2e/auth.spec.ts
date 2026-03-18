import { test, expect } from '@playwright/test'

test.describe('Authentication redirects', () => {
  test('unauthenticated user visiting home is redirected to sign-in', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/sign-in/)
  })

  test('unauthenticated user visiting a room is redirected to sign-in with next param', async ({ page }) => {
    await page.goto('/room/ABC1234')
    await expect(page).toHaveURL(/\/sign-in\?next=/)
  })

  test('unauthenticated user visiting create room is redirected to sign-in', async ({ page }) => {
    await page.goto('/rooms/new')
    await expect(page).toHaveURL(/\/sign-in/)
  })

  test('unauthenticated user visiting join room is redirected to sign-in', async ({ page }) => {
    await page.goto('/rooms/join')
    await expect(page).toHaveURL(/\/sign-in/)
  })

  test('sign-in page renders the Google sign-in button', async ({ page }) => {
    await page.goto('/sign-in')
    await expect(page.getByRole('button', { name: /google/i })).toBeVisible()
  })
})
