import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse, type NextRequest } from 'next/server'
import { resolveDroppedTurnChain } from '@/lib/game/autoResolve'

const RECONNECT_WINDOW_MS = 60_000

interface RouteContext {
  params: Promise<{ gameId: string }>
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { gameId } = await params
  const supabase = await createClient()
  const admin = createAdminClient()

  // Auth
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Parse body
  let disconnectedUserId: string
  try {
    const body = await request.json()
    if (!body.disconnectedUserId || typeof body.disconnectedUserId !== 'string') throw new Error()
    disconnectedUserId = body.disconnectedUserId
  } catch {
    return NextResponse.json({ error: 'disconnectedUserId is required' }, { status: 400 })
  }

  // Fix 1.2: Self-drop guard — a player cannot drop themselves
  if (disconnectedUserId === user.id) {
    return NextResponse.json({ error: 'Cannot drop yourself' }, { status: 400 })
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

  // Verify caller is an active player in this game
  const { data: callerPlayer } = await admin
    .from('room_players')
    .select('id')
    .eq('room_id', game.room_id)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle()

  if (!callerPlayer) {
    return NextResponse.json({ error: 'Not a player in this game' }, { status: 403 })
  }

  // Fetch the target player's current status and disconnected_at
  const { data: targetPlayer } = await admin
    .from('room_players')
    .select('id, status, disconnected_at')
    .eq('room_id', game.room_id)
    .eq('user_id', disconnectedUserId)
    .maybeSingle()

  if (!targetPlayer) {
    return NextResponse.json({ error: 'Player not found in this game' }, { status: 404 })
  }

  if (targetPlayer.status === 'dropped') {
    return NextResponse.json({ status: 'already_dropped' }, { status: 200 })
  }

  if (targetPlayer.status !== 'disconnected') {
    return NextResponse.json({ error: 'Player is not disconnected' }, { status: 422 })
  }

  // Server-side enforcement: the reconnection window must have fully elapsed
  const disconnectedAt = new Date(targetPlayer.disconnected_at as string).getTime()
  if (Date.now() < disconnectedAt + RECONNECT_WINDOW_MS) {
    return NextResponse.json({ status: 'too_early' }, { status: 422 })
  }

  // Conditionally update to 'dropped' — idempotent (concurrent calls no-op)
  const { data: dropped, error: dropError } = await admin
    .from('room_players')
    .update({ status: 'dropped' })
    .eq('room_id', game.room_id)
    .eq('user_id', disconnectedUserId)
    .eq('status', 'disconnected')
    .select('id')

  if (dropError) {
    console.error('[drop-player] UPDATE error:', dropError)
    return NextResponse.json({ error: 'Failed to drop player' }, { status: 500 })
  }

  if (!dropped || dropped.length === 0) {
    return NextResponse.json({ status: 'already_dropped' }, { status: 200 })
  }

  // Fix 1.1: Compute cumulative score earned before this drop, scoped to this game only
  // First get the round IDs for this game, then filter round_scores to those rounds.
  const { data: gameRounds } = await admin.from('rounds').select('id').eq('game_id', gameId)
  const gameRoundIds = (gameRounds ?? []).map((r) => r.id)
  const { data: scores } = gameRoundIds.length > 0
    ? await admin.from('round_scores').select('score').in('round_id', gameRoundIds).eq('player_id', disconnectedUserId)
    : { data: [] }

  const totalScore = (scores ?? []).reduce((sum, r) => sum + r.score, 0)

  // Fix 1.4: Idempotent game_results — check if a row already exists before inserting
  const { data: existingResult } = await admin
    .from('game_results')
    .select('id')
    .eq('game_id', gameId)
    .eq('player_id', disconnectedUserId)
    .maybeSingle()

  if (!existingResult) {
    // Record the loss — placement 0 indicates a mid-game drop (not a final placement)
    const { error: insertError } = await admin.from('game_results').insert({
      game_id: gameId,
      player_id: disconnectedUserId,
      placement: 0,
      result: 'loss',
      total_score: totalScore,
    })

    if (insertError) {
      console.error('[drop-player] game_results insert error:', insertError)
      return NextResponse.json({ error: 'Failed to record game result' }, { status: 500 })
    }
  }

  // Fix 1.3: Server-side auto-resolve — if the dropped player holds the current turn,
  // resolve it immediately so the game continues without client-side polling.
  await resolveDroppedTurnChain(admin, gameId, game.room_id)

  return NextResponse.json({ status: 'dropped' }, { status: 200 })
}
