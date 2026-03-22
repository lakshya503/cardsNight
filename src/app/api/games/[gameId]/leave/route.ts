import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse, type NextRequest } from 'next/server'
import { resolveDroppedTurnChain } from '@/lib/game/autoResolve'

interface RouteContext {
  params: Promise<{ gameId: string }>
}

export async function POST(_request: NextRequest, { params }: RouteContext) {
  const { gameId } = await params
  const supabase = await createClient()
  const admin = createAdminClient()

  // Auth
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Fetch game
  const { data: game } = await admin
    .from('games')
    .select('id, room_id, status')
    .eq('id', gameId)
    .maybeSingle()

  if (!game || game.status !== 'in_progress') {
    return NextResponse.json({ error: 'Game not found or not in progress' }, { status: 404 })
  }

  // Verify caller is a participant in this game (active or disconnected)
  const { data: callerPlayer } = await admin
    .from('room_players')
    .select('id')
    .eq('room_id', game.room_id)
    .eq('user_id', user.id)
    .in('status', ['active', 'disconnected'])
    .maybeSingle()

  if (!callerPlayer) {
    return NextResponse.json({ error: 'Not a player in this game' }, { status: 403 })
  }

  // Conditionally update to 'dropped' — idempotent (concurrent or duplicate calls no-op)
  const { data: dropped, error: dropError } = await admin
    .from('room_players')
    .update({ status: 'dropped', disconnected_at: new Date().toISOString() })
    .eq('room_id', game.room_id)
    .eq('user_id', user.id)
    .in('status', ['active', 'disconnected'])
    .select('id')

  if (dropError) {
    console.error('[leave] UPDATE error:', dropError)
    return NextResponse.json({ error: 'Failed to record leave' }, { status: 500 })
  }

  if (!dropped || dropped.length === 0) {
    return NextResponse.json({ status: 'already_dropped' }, { status: 200 })
  }

  // Compute cumulative score scoped to this game only
  const { data: gameRounds } = await admin.from('rounds').select('id').eq('game_id', gameId)
  const gameRoundIds = (gameRounds ?? []).map((r) => r.id)
  const { data: scores } = gameRoundIds.length > 0
    ? await admin.from('round_scores').select('score').in('round_id', gameRoundIds).eq('player_id', user.id)
    : { data: [] }

  const totalScore = (scores ?? []).reduce((sum, r) => sum + r.score, 0)

  // Upsert — if a peer-drop already wrote a row with a stale score, update it with the
  // more accurate score computed here. Double-tap idempotency is handled upstream by the
  // conditional UPDATE (already_dropped branch returns early before reaching this point).
  const { error: upsertError } = await admin.from('game_results').upsert(
    { game_id: gameId, player_id: user.id, placement: 0, result: 'loss', total_score: totalScore },
    { onConflict: 'game_id,player_id' }
  )

  if (upsertError) {
    console.error('[leave] game_results upsert error:', upsertError)
    return NextResponse.json({ error: 'Failed to record game result' }, { status: 500 })
  }

  // If it was this player's turn, advance the game for remaining players
  await resolveDroppedTurnChain(admin, gameId, game.room_id)

  return NextResponse.json({ status: 'left' }, { status: 200 })
}
