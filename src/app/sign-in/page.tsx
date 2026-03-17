import { signInWithGoogle } from '@/app/auth/actions'
import { createClient } from '@/lib/supabase/server'
import { copy } from '@/lib/ui/copy'
import { redirect } from 'next/navigation'

interface SignInPageProps {
  searchParams: Promise<{ next?: string; error?: string }>
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const { next, error } = await searchParams

  // Redirect already-authenticated users (belt-and-suspenders — middleware handles this too)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) redirect(next?.startsWith('/') ? next : '/')

  const signInWithNext = signInWithGoogle.bind(null, next ?? '/')

  return (
    <main className="min-h-screen flex items-center justify-center px-4"
          style={{ backgroundColor: 'var(--color-background)' }}>
      <div
        className="w-full max-w-sm flex flex-col items-center gap-8 rounded-xl p-10"
        style={{
          backgroundColor: 'var(--color-surface)',
          boxShadow: 'var(--shadow-lg)',
          borderRadius: 'var(--radius-xl)',
        }}
      >
        {/* Logo / wordmark */}
        <div className="text-center">
          <h1
            className="text-4xl font-bold tracking-tight"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--color-primary)' }}
          >
            cardsNight
          </h1>
          <p className="mt-2 text-sm" style={{ color: 'var(--color-text-muted)' }}>
            {copy.auth.signInSubheading}
          </p>
        </div>

        {/* Error message */}
        {error && (
          <p
            className="w-full text-center text-sm rounded-lg px-4 py-3"
            style={{
              backgroundColor: 'var(--color-error-light)',
              color: 'var(--color-error)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            {copy.errors.generic}
          </p>
        )}

        {/* Google Sign-In button */}
        <form action={signInWithNext} className="w-full">
          <button
            type="submit"
            className="w-full flex items-center justify-center gap-3 px-6 py-3 font-medium transition-colors cursor-pointer"
            style={{
              backgroundColor: 'var(--color-primary)',
              color: 'var(--color-text-on-primary)',
              borderRadius: 'var(--radius-md)',
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--color-primary-hover)'
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--color-primary)'
            }}
          >
            <GoogleIcon />
            {copy.auth.signInButton}
          </button>
        </form>

        <p className="text-xs text-center" style={{ color: 'var(--color-text-muted)' }}>
          Play card games with friends. No download needed.
        </p>
      </div>
    </main>
  )
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#ffffff"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
      />
      <path
        fill="#ffffffcc"
        d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
      />
      <path
        fill="#ffffffaa"
        d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z"
      />
      <path
        fill="#ffffffcc"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.961L3.964 7.293C4.672 5.163 6.656 3.58 9 3.58z"
      />
    </svg>
  )
}
