import { createClient } from '@/lib/supabase/server'
import { signOut } from '@/app/auth/actions'
import { copy } from '@/lib/ui/copy'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import ToastBanner from '@/components/ToastBanner'

const TOAST_MESSAGES: Record<string, string> = {
  room_invalid:     copy.errors.roomInvalid,
  room_full:        copy.errors.roomFull,
  room_in_progress: copy.errors.roomInProgress,
}

interface HomePageProps {
  searchParams: Promise<{ toast?: string }>
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const { toast } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/sign-in')

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, avatar_url')
    .eq('id', user.id)
    .single()

  const displayName = profile?.display_name ?? user.email ?? 'Player'
  const avatarUrl = profile?.avatar_url

  const toastMessage = toast ? (TOAST_MESSAGES[toast] ?? null) : null

  return (
    <main
      className="min-h-screen flex flex-col"
      style={{ backgroundColor: 'var(--color-background)' }}
    >
      {toastMessage && <ToastBanner message={toastMessage} />}

      {/* Header */}
      <header
        className="flex items-center justify-between px-6 py-4"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <h1
          className="text-2xl font-bold"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--color-primary)' }}
        >
          cardsNight
        </h1>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            {avatarUrl && (
              <Image
                src={avatarUrl}
                alt={displayName}
                width={32}
                height={32}
                className="rounded-full"
              />
            )}
            <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
              {displayName}
            </span>
          </div>

          <form action={signOut}>
            <button
              type="submit"
              className="text-sm cursor-pointer px-3 py-1.5"
              style={{
                color: 'var(--color-text-muted)',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              {copy.auth.signOutButton}
            </button>
          </form>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 gap-10">
        <div className="text-center">
          <h2
            className="text-5xl font-bold tracking-tight"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text)' }}
          >
            {copy.home.heading}
          </h2>
          <p className="mt-3 text-lg" style={{ color: 'var(--color-text-muted)' }}>
            {copy.home.subheading}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 w-full max-w-sm">
          <Link
            href="/rooms/new"
            className="flex-1 flex items-center justify-center px-6 py-4 font-semibold text-center"
            style={{
              backgroundColor: 'var(--color-primary)',
              color: 'var(--color-text-on-primary)',
              borderRadius: 'var(--radius-lg)',
            }}
          >
            {copy.home.createRoom}
          </Link>

          <Link
            href="/rooms/join"
            className="flex-1 flex items-center justify-center px-6 py-4 font-semibold text-center"
            style={{
              backgroundColor: 'var(--color-surface)',
              color: 'var(--color-primary)',
              border: '2px solid var(--color-primary)',
              borderRadius: 'var(--radius-lg)',
            }}
          >
            {copy.home.joinRoom}
          </Link>
        </div>
      </div>
    </main>
  )
}
