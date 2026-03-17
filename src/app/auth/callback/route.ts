import { createClient } from '@/lib/supabase/server'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Handles the OAuth callback from Supabase after Google sign-in.
 * Exchanges the one-time code for a session, then redirects the user.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/'

  if (!code) {
    // No code means something went wrong upstream — send to sign-in
    return NextResponse.redirect(new URL('/sign-in', request.url))
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    console.error('[auth/callback] Failed to exchange code for session:', error.message)
    return NextResponse.redirect(new URL('/sign-in', request.url))
  }

  // Redirect to the page the user originally tried to visit, or home
  const redirectTo = next.startsWith('/') ? next : '/'
  return NextResponse.redirect(new URL(redirectTo, request.url))
}
