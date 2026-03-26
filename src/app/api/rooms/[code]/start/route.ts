import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse, type NextRequest } from 'next/server'
import {
  getStartingHandSize,
  getStartingBidderIndex,
  dealHands,
  drawTrump,
} from '@/lib/game/gameRules'
import { MIN_PLAYERS } from '@/lib/game/validation'

interface RouteContext {
  params: Promise<{ code: string }>
}

export async function POST(_request: NextRequest, { params }: RouteContext) {
  const { code } = await params
  const supabase = await createClient()
  const admin = createAdminClient()

  // Auth
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Fetch room
  const { data: room } = await supabase
    .from('rooms')
    .select('id, host_id, status')
    .eq('code', code.toUpperCase())
    .neq('status', 'cancelled')
    .maybeSingle()

  if (!room) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 })
  }

  if (room.host_id !== user.id) {
    return NextResponse.json({ error: 'Only the host can start the game' }, { status: 403 })
  }

  // Fetch active players
  const { data: activePlayers } = await admin
    .from('room_players')
    .select('id, user_id')
    .eq('room_id', room.id)
    .eq('status', 'active')

  if (!activePlayers || activePlayers.length < MIN_PLAYERS) {
    return NextResponse.json(
      { error: `Need at least ${MIN_PLAYERS} players to start` },
      { status: 422 }
    )
  }

  // Atomic claim — prevents concurrent double-starts.
  // Returns false if another caller already transitioned the room to in_progress.
  const { data: claimed, error: claimError } = await admin.rpc('claim_room_start', { p_room_id: room.id })
  if (claimError) {
    console.error('[start] claim_room_start RPC error:', claimError)
    return NextResponse.json({ error: 'Failed to start game' }, { status: 500 })
  }
  if (!claimed) {
    return NextResponse.json({ error: 'Game already started' }, { status: 422 })
  }

  // Rollback helper — if any post-claim write fails, revert room to waiting so it
  // can be started again. Only valid while this caller holds the claim (i.e. after
  // claim_room_start returned true and before current_game_id is set).
  async function releaseRoom() {
    await admin.from('rooms').update({ status: 'waiting' }).eq('id', room.id)
  }

  const playerCount = activePlayers.length
  const startingHandSize = getStartingHandSize(playerCount)

  // Shuffle players and assign seat_order 0..n-1
  const shuffled = [...activePlayers].sort(() => Math.random() - 0.5)
  await Promise.all(
    shuffled.map((p, i) =>
      admin.from('room_players').update({ seat_order: i }).eq('id', p.id)
    )
  )

  // Ordered player IDs by seat (0-indexed)
  const playerIds = shuffled.map((p) => p.user_id)

  // Create game row
  const { data: game, error: gameError } = await admin
    .from('games')
    .insert({ room_id: room.id, starting_hand_size: startingHandSize, status: 'in_progress' })
    .select('id')
    .single()

  if (gameError || !game) {
    console.error('[start] Game insert error:', gameError)
    await releaseRoom()
    return NextResponse.json({ error: 'Failed to create game' }, { status: 500 })
  }

  // Deal hands and draw trump (pure, in-memory)
  const { hands, remaining } = dealHands(playerIds, startingHandSize)
  const { trumpCard, trumpSuit } = drawTrump(remaining)

  // Create round 1 — we need round.id before inserting hands
  const { data: round, error: roundError } = await admin
    .from('rounds')
    .insert({
      game_id: game.id,
      round_number: 1,
      hand_size: startingHandSize,
      trump_suit: trumpSuit,
      trump_card_value: trumpCard.value,
      status: 'bidding',
      current_player_id: playerIds[getStartingBidderIndex(1, playerCount)],
      turn_started_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (roundError || !round) {
    console.error('[start] Round insert error:', roundError)
    await releaseRoom()
    return NextResponse.json({ error: 'Failed to create round' }, { status: 500 })
  }

  // Insert hands rows (immutable — one row per player per round)
  const { error: handsError } = await admin.from('hands').insert(
    playerIds.map((playerId) => ({
      round_id: round.id,
      player_id: playerId,
      cards: hands[playerId],
    }))
  )

  if (handsError) {
    console.error('[start] Hands insert error:', handsError)
    await releaseRoom()
    return NextResponse.json({ error: 'Failed to deal hands' }, { status: 500 })
  }

  // Update room — triggers WaitingRoom Realtime redirect for all players
  // status was already set to 'in_progress' by claim_room_start RPC
  const { error: roomUpdateError } = await admin
    .from('rooms')
    .update({ current_game_id: game.id })
    .eq('id', room.id)

  if (roomUpdateError) {
    console.error('[start] Room update error:', roomUpdateError)
    // Note: game/round/hands rows may exist at this point but the room never
    // signals players to redirect — reverting status lets the host retry.
    await releaseRoom()
    return NextResponse.json({ error: 'Failed to start game' }, { status: 500 })
  }

  return NextResponse.json({ gameId: game.id }, { status: 200 })
}
