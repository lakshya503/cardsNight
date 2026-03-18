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

export async function createTestUser(label: string): Promise<TestUser> {
  const admin = adminClient()
  const email = `test-${label}-${Date.now()}@cardsnight.test`
  const password = 'Test1234!'
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (error || !data.user) {
    throw new Error(`createTestUser failed: ${error?.message}`)
  }
  return { email, password, userId: data.user.id }
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
