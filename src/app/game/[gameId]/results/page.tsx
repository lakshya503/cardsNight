import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { ResultsPanel } from './ResultsPanel'

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

  // Allow active, disconnected, and dropped players to view results.
  // Dropped players (intentional leave or timeout) should still see the outcome.
  const { data: roomPlayer } = await admin
    .from('room_players')
    .select('id')
    .eq('room_id', game.room_id)
    .eq('user_id', user.id)
    .in('status', ['active', 'disconnected', 'dropped'])
    .maybeSingle()

  if (!roomPlayer) redirect('/')

  const { data: results } = await admin
    .from('game_results')
    .select('player_id, placement, result, total_score, profiles(display_name)')
    .eq('game_id', gameId)
    .order('placement', { ascending: true })

  // Repair pass: if the game is finished, ensure every non-active player has a
  // game_results row. This is a safety net for cases where the beforeunload fetch
  // didn't fire (e.g. browser killed, network failure).
  if (game.status === 'finished') {
    const { data: allRoomPlayers } = await admin
      .from('room_players')
      .select('user_id')
      .eq('room_id', game.room_id)
      .in('status', ['active', 'disconnected', 'dropped'])

    const existingResultIds = new Set((results ?? []).map((r) => r.player_id))
    const missing = (allRoomPlayers ?? []).filter((p) => !existingResultIds.has(p.user_id))

    if (missing.length > 0) {
      const { data: gameRounds } = await admin.from('rounds').select('id').eq('game_id', gameId)
      const gameRoundIds = (gameRounds ?? []).map((r) => r.id)

      for (const p of missing) {
        const { data: playerScores } = gameRoundIds.length > 0
          ? await admin.from('round_scores').select('score').in('round_id', gameRoundIds).eq('player_id', p.user_id)
          : { data: [] }
        const totalScore = (playerScores ?? []).reduce((sum, r) => sum + r.score, 0)

        await admin.from('game_results').insert({
          game_id: gameId,
          player_id: p.user_id,
          placement: 0,
          result: 'loss',
          total_score: totalScore,
        })
      }
    }
  }

  const myResult = results?.find((r) => r.player_id === user.id)
  const isWinner = myResult?.result === 'win'

  const normalised = (results ?? []).map((r) => ({
    player_id: r.player_id,
    placement: r.placement,
    result: r.result,
    total_score: r.total_score,
    display_name: (r.profiles as { display_name: string } | null)?.display_name ?? 'Player',
  }))

  return (
    <main className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-6">
      <ResultsPanel
        results={normalised}
        currentUserId={user.id}
        isWinner={isWinner}
      />
    </main>
  )
}
