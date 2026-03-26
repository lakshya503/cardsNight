import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { copy } from '@/lib/ui/copy'

// Supabase may type an embedded FK relation as an array or a scalar depending on the
// schema introspection. This helper normalises both cases to a single object or null.
export function extractGame(raw: unknown): { finished_at?: string | null; rooms?: { game_type?: string } | null } | null {
  if (!raw) return null
  const scalar = Array.isArray(raw) ? raw[0] : raw
  return scalar ?? null
}

type HistoryRow = { result: string; games: unknown }

export function computeStats(rows: HistoryRow[]) {
  const totalGames = rows.length
  const wins = rows.filter((r) => r.result === 'win').length
  const winRate = totalGames > 0 ? Math.round((wins / totalGames) * 100) : null

  let latestFinishedAt: string | null = null
  for (const r of rows) {
    const fa = extractGame(r.games)?.finished_at
    if (fa && (!latestFinishedAt || fa > latestFinishedAt)) latestFinishedAt = fa
  }

  return { totalGames, wins, winRate, latestFinishedAt }
}

export default async function ProfilePage() {
  const supabase = await createClient()
  const admin = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const isGuest = user.is_anonymous === true

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, avatar_url')
    .eq('id', user.id)
    .single()

  const displayName = profile?.display_name ?? user.email ?? 'Player'
  const avatarUrl = profile?.avatar_url

  let rows: {
    id: string
    placement: number
    result: string
    total_score: number
    created_at: string
    games: unknown
  }[] = []

  if (!isGuest) {
    // Use explicit FK hints to disambiguate: games→rooms has two FK paths
    // (games.room_id→rooms.id AND rooms.current_game_id→games.id).
    // Without hints PostgREST returns HTTP 300 and data is null, causing 0 stats.
    const { data: history, error: historyError } = await admin
      .from('game_results')
      .select('id, placement, result, total_score, created_at, games!game_results_game_id_fkey(finished_at, rooms!games_room_id_fkey(game_type))')
      .eq('player_id', user.id)
      .order('created_at', { ascending: false })

    if (historyError) {
      console.error('[profile] Failed to fetch game history:', historyError)
    }
    rows = history ?? []
  }

  const { totalGames, wins, winRate, latestFinishedAt } = computeStats(rows)

  const lastPlayed = latestFinishedAt
    ? new Date(latestFinishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
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
          <span style={{ color: 'var(--color-text)' }}>cards</span><span style={{ color: 'var(--color-primary)' }}>Night</span>
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

        {/* Guest banner */}
        {isGuest && (
          <div
            className="rounded-xl px-5 py-4 text-sm"
            style={{
              backgroundColor: 'var(--color-surface)',
              color: 'var(--color-text-muted)',
              border: '1px solid var(--color-border)',
            }}
          >
            {copy.guest.profileBanner}
          </div>
        )}

        <h1 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>
          Profile
        </h1>

        {/* Stats strip — hidden for guests */}
        {!isGuest && (
          <section>
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
        )}

        {/* Game history — hidden for guests */}
        {!isGuest && (
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
                  const game = extractGame(r.games)
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
                      key={r.id}
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
                        {!isLeft && r.placement > 0 && (
                          <span className="text-xs tabular-nums" style={{ color: 'var(--color-text-muted)' }}>
                            #{r.placement}
                          </span>
                        )}
                        <span className="text-sm tabular-nums font-medium">{r.total_score} pts</span>
                        <span
                          className="text-xs font-semibold px-2 py-0.5 rounded-full"
                          style={
                            isWin
                              ? { backgroundColor: 'var(--color-success-light)', color: 'var(--color-success)' }
                              : { backgroundColor: 'var(--color-surface-raised)', color: 'var(--color-text-muted)' }
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
        )}
      </div>
    </main>
  )
}
