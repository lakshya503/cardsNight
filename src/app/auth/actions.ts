'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { validateGuestName } from '@/lib/auth/guestName'

export async function signInWithGoogle(next: string = '/') {
  const supabase = await createClient()

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
  const callbackUrl = new URL('/auth/callback', siteUrl)
  if (next && next.startsWith('/')) {
    callbackUrl.searchParams.set('next', next)
  }

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: callbackUrl.toString(),
    },
  })

  if (error || !data.url) {
    redirect('/sign-in?error=oauth_failed')
  }

  redirect(data.url)
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/sign-in')
}

export async function signInAsGuest(formData: FormData) {
  const displayName = validateGuestName(formData.get('displayName'))

  if (!displayName) {
    redirect('/sign-in?error=invalid_name')
  }

  const next = formData.get('next')
  const destination = typeof next === 'string' && next.startsWith('/') ? next : '/'

  const supabase = await createClient()
  const { error } = await supabase.auth.signInAnonymously({
    options: { data: { full_name: displayName } },
  })

  if (error) {
    console.error('[guest-auth] signInAnonymously error:', error)
    redirect('/sign-in?error=guest_failed')
  }

  redirect(destination)
}
