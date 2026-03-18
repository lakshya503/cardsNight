import { createClient } from '@/lib/supabase/server'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Test-only sign-in endpoint. Signs in with email/password and sets session cookies
 * on the response so the Playwright page context becomes authenticated.
 * Disabled in production.
 */
export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available' }, { status: 404 })
  }

  const { email, password } = await request.json()
  const supabase = await createClient()

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error || !data.user) {
    return NextResponse.json({ error: error?.message ?? 'Sign in failed' }, { status: 401 })
  }

  return NextResponse.json({ userId: data.user.id }, { status: 200 })
}
