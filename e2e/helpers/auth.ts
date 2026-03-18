import { createClient } from '@supabase/supabase-js'
import type { Page } from '@playwright/test'

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export interface TestUser {
  email: string
  password: string
  userId: string
}

// Fixed email per label — avoids accumulating throwaway accounts and sidesteps
// Supabase Auth burst rate limits when multiple workers create users in parallel.
export async function createTestUser(label: string): Promise<TestUser> {
  const admin = adminClient()
  const email = `test-${label}@cardsnight.test`
  const password = 'Test1234!'

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (!error) {
    return { email, password, userId: data.user.id }
  }

  // User already exists (prior run wasn't cleaned up) — fetch the existing one.
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 })
  const existing = list?.users.find((u) => u.email === email)
  if (existing) {
    // Reset password so we know it matches, then return.
    await admin.auth.admin.updateUserById(existing.id, { password })
    return { email, password, userId: existing.id }
  }

  throw new Error(`createTestUser failed: ${error.message}`)
}

export async function deleteTestUser(userId: string): Promise<void> {
  const admin = adminClient()
  await admin.auth.admin.deleteUser(userId)
}

/**
 * Signs in via the test-only endpoint. The response sets session cookies on the
 * page context so subsequent page navigations are authenticated.
 */
export async function signIn(page: Page, email: string, password: string): Promise<void> {
  const res = await page.request.post('/api/test/auth', { data: { email, password } })
  if (!res.ok()) {
    throw new Error(`signIn failed (${res.status()}): ${await res.text()}`)
  }
}
