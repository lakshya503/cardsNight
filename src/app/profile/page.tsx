import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'

interface PageProps {
  params: Promise<Record<string, never>>
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default async function ProfilePage(_props: PageProps) {
  const supabase = await createClient()
  const admin = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, avatar_url')
    .eq('id', user.id)
    .single()

  const displayName = profile?.display_name ?? user.email ?? 'Player'
  const avatarUrl = profile?.avatar_url

  const { data: history } = await admin
    .from('game_results')
    .select('placement, result, total_score, created_at, games(finished_at, rooms(game_type))')
    .eq('player_id', user.id)
    .order('created_at', { ascending: false })

  const rows = history ?? []
  const totalGames = rows.length
  const wins = rows.filter((r) => r.result === 'win').length
  const winRate = totalGames > 0 ? Math.round((wins / totalGames) * 100) : null

  const lastPlayedRaw = (rows[0]?.games as { finished_at?: string | null } | null)?.finished_at
  const lastPlayed = lastPlayedRaw
    ? new Date(lastPlayedRaw).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : 'Never'

  return (
    <main className="min-h-screen flex flex-col" style={{ backgroundColor: 'var(--color-background)', color: 'var(--color-text)' }}>

      {/* Header */}
      <header
        className="flex items-center justify-between px-6 py-4"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <Link
          href="/"
          className="text-2xl font-bold"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--color-primary)' }}
        >
          cardsNight
        </Link>
        <div className="flex items-center gap-2">
          {avatarUrl && (
            <Image src={avatarUrl} alt={displayName} width={28} height={28} className="rounded-full" />
          )}
          <span className="text-sm font-medium" style={{ color: 'var(--color-text-muted)' }}>
            {displayName}
          </span>
        </div>
      </header>

      <div className="flex-1 w-full max-w-lg mx-auto px-4 py-8 flex flex-col gap-8">

        {/* Stats strip */}
        <section>
          <h1 className="text-2xl font-bold mb-5" style={{ fontFamily: 'var(--font-display)' }}>
            Profile
          </h1>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Games', value: totalGames },
              { label: 'Wins', value: wins },
              { label: 'Win rate', value: winRate !== null ? `${winRate}%` : '—' },
              { label: 'Last played', value: lastPlayed },
            ].map(({ label, value }) => (
              <div
                key={label}
                className="flex flex-col gap-1 p-4 rounded-xl"
                style={{ backgroundColor: 'var(--color-surface)' }}
              >
                <span className="text-xs uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>
                  {label}
                </span>
                <span className="text-xl font-bold tabular-nums">{value}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Game history */}
        <section>
          <h2 className="text-sm uppercase tracking-wide mb-3" style={{ color: 'var(--color-text-muted)' }}>
            Game history
          </h2>

          {rows.length === 0 ? (
            <div
              className="rounded-xl p-8 text-center"
              style={{ backgroundColor: 'var(--color-surface)' }}
            >
              <p className="mb-3" style={{ color: 'var(--color-text-muted)' }}>No games played yet.</p>
              <Link
                href="/"
                className="text-sm font-semibold"
                style={{ color: 'var(--color-primary)' }}
              >
                Play a game →
              </Link>
            </div>
          ) : (
            <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--color-surface)' }}>
              {rows.map((r, i) => {
                const game = r.games as { finished_at?: string | null; rooms?: { game_type?: string } | null } | null
                const gameType = game?.rooms?.game_type
                  ? game.rooms.game_type.charAt(0).toUpperCase() + game.rooms.game_type.slice(1)
                  : 'Judgement'
                const date = game?.finished_at
                  ? new Date(game.finished_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                  : '—'
                const isLeft = r.placement === 0
                const isWin = r.result === 'win'

                return (
                  <div
                    key={i}
                    className="flex items-center justify-between px-4 py-3"
                    style={{
                      borderBottom: i < rows.length - 1 ? '1px solid var(--color-border)' : undefined,
                    }}
                  >
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="text-sm font-medium">{gameType}</span>
                      <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{date}</span>
                    </div>

                    <div className="flex items-center gap-4">
                      {/* Placement — hidden for mid-game drops */}
                      {!isLeft && r.placement > 0 && (
                        <span className="text-xs tabular-nums" style={{ color: 'var(--color-text-muted)' }}>
                          #{r.placement}
                        </span>
                      )}

                      {/* Score */}
                      <span className="text-sm tabular-nums font-medium">{r.total_score} pts</span>

                      {/* Result badge */}
                      <span
                        className="text-xs font-semibold px-2 py-0.5 rounded-full"
                        style={
                          isWin
                            ? { backgroundColor: 'rgba(52,211,153,0.15)', color: 'var(--color-success, #34d399)' }
                            : { backgroundColor: 'var(--color-surface-raised, rgba(255,255,255,0.06))', color: 'var(--color-text-muted)' }
                        }
                      >
                        {isWin ? 'Win' : isLeft ? 'Left' : 'Loss'}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
