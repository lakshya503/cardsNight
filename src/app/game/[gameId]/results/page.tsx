import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import Link from 'next/link'

interface PageProps {
  params: Promise<{ gameId: string }>
}

export default async function ResultsPage({ params }: PageProps) {
  const { gameId } = await params
  const supabase = await createClient()
  const admin = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const { data: game } = await admin
    .from('games')
    .select('id, status, room_id')
    .eq('id', gameId)
    .maybeSingle()

  if (!game) redirect('/')

  // Verify user is a player in this game
  const { data: roomPlayer } = await admin
    .from('room_players')
    .select('id')
    .eq('room_id', game.room_id)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle()

  if (!roomPlayer) redirect('/')

  // Fetch results
  const { data: results } = await admin
    .from('game_results')
    .select('player_id, placement, result, total_score, profiles(display_name)')
    .eq('game_id', gameId)
    .order('placement', { ascending: true })

  const myResult = results?.find((r) => r.player_id === user.id)
  const isWinner = myResult?.result === 'win'

  return (
    <main className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-4xl font-fraunces mb-2">
            {isWinner ? 'You won!' : 'Game over'}
          </h1>
          <p className="text-slate-400">Final standings</p>
        </div>

        <div data-testid="results-panel" className="bg-slate-800 rounded-xl overflow-hidden">
          {(results ?? []).map((r, i) => {
            const name = (r.profiles as { display_name: string } | null)?.display_name ?? 'Player'
            const isMe = r.player_id === user.id
            return (
              <div
                key={r.player_id}
                className={[
                  'flex items-center justify-between p-4',
                  i < (results?.length ?? 0) - 1 ? 'border-b border-slate-700' : '',
                  isMe ? 'bg-slate-700' : '',
                ].join(' ')}
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl font-bold text-slate-500 w-8">
                    {r.placement}
                  </span>
                  <div>
                    <p className="font-semibold">
                      {name} {isMe && <span className="text-xs text-indigo-400">(you)</span>}
                    </p>
                    <p className="text-xs text-slate-400">
                      {r.result === 'win' ? '🏆 Winner' : 'Finished'}
                    </p>
                  </div>
                </div>
                <span className="text-xl font-bold tabular-nums">{r.total_score}</span>
              </div>
            )
          })}
        </div>

        <div className="flex justify-center">
          <Link
            href="/"
            className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 rounded-lg font-semibold transition-colors"
          >
            Back to home
          </Link>
        </div>
      </div>
    </main>
  )
}
