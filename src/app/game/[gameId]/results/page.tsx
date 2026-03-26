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

  if (!game) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6" style={{ backgroundColor: 'var(--color-background)', color: 'var(--color-text)' }}>
        <div className="text-center space-y-3">
          <p className="text-lg font-semibold">Game not found</p>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>This game doesn&apos;t exist or has been removed.</p>
          <a href="/" className="text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>Back to home</a>
        </div>
      </main>
    )
  }

  // Allow active, disconnected, and dropped players to view results.
  // Players who left intentionally (dropped) should still see the outcome.
  const { data: roomPlayer } = await admin
    .from('room_players')
    .select('id')
    .eq('room_id', game.room_id)
    .eq('user_id', user.id)
    .in('status', ['active', 'disconnected', 'dropped'])
    .maybeSingle()

  if (!roomPlayer) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6" style={{ backgroundColor: 'var(--color-background)', color: 'var(--color-text)' }}>
        <div className="text-center space-y-3">
          <p className="text-lg font-semibold">Access denied</p>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>You weren&apos;t part of this game.</p>
          <a href="/" className="text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>Back to home</a>
        </div>
      </main>
    )
  }

  // Repair pass: if the game is finished, ensure every dropped/disconnected player
  // has a game_results row. Safety net for cases where the explicit leave wasn't
  // triggered (e.g. network failure, browser killed). Active players are excluded —
  // they should have results written by the game-end logic, not this pass.
  if (game.status === 'finished') {
    const { data: droppedPlayers } = await admin
      .from('room_players')
      .select('user_id')
      .eq('room_id', game.room_id)
      .in('status', ['disconnected', 'dropped'])

    if (droppedPlayers && droppedPlayers.length > 0) {
      // Fresh fetch of existing results to avoid race with in-flight leave requests
      const { data: existingResults } = await admin
        .from('game_results')
        .select('player_id')
        .eq('game_id', gameId)
      const existingResultIds = new Set((existingResults ?? []).map((r) => r.player_id))
      const missing = droppedPlayers.filter((p) => !existingResultIds.has(p.user_id))

      if (missing.length > 0) {
        const { data: gameRounds } = await admin.from('rounds').select('id').eq('game_id', gameId)
        const gameRoundIds = (gameRounds ?? []).map((r) => r.id)

        for (const p of missing) {
          const { data: playerScores } = gameRoundIds.length > 0
            ? await admin.from('round_scores').select('score').in('round_id', gameRoundIds).eq('player_id', p.user_id)
            : { data: [] }
          const totalScore = (playerScores ?? []).reduce((sum, r) => sum + r.score, 0)

          // Idempotent: ignore conflict if a concurrent request already inserted
          await admin.from('game_results').upsert(
            { game_id: gameId, player_id: p.user_id, placement: 0, result: 'loss', total_score: totalScore },
            { onConflict: 'game_id,player_id', ignoreDuplicates: true }
          )
        }
      }
    }
  }

  // Fetch after repair pass so newly-inserted rows for dropped players are included.
  // Sort: finished players by placement ascending; dropped players (placement 0) last.
  const { data: results } = await admin
    .from('game_results')
    .select('player_id, placement, result, total_score, profiles(display_name)')
    .eq('game_id', gameId)

  const sortedResults = (results ?? []).slice().sort((a, b) => {
    if (a.placement === 0 && b.placement === 0) return 0
    if (a.placement === 0) return 1
    if (b.placement === 0) return -1
    return a.placement - b.placement
  })

  const myResult = sortedResults.find((r) => r.player_id === user.id)
  const isWinner = myResult?.result === 'win'

  const normalised = sortedResults.map((r) => ({
    player_id: r.player_id,
    placement: r.placement,
    result: r.result,
    total_score: r.total_score,
    display_name: (r.profiles as { display_name: string } | null)?.display_name ?? 'Player',
  }))

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6" style={{ backgroundColor: 'var(--color-background)', color: 'var(--color-text)' }}>
      <ResultsPanel
        results={normalised}
        currentUserId={user.id}
        isWinner={isWinner}
      />
    </main>
  )
}
