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

  if (room.status !== 'waiting') {
    return NextResponse.json({ error: 'Game already started' }, { status: 422 })
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
    })
    .select('id')
    .single()

  if (roundError || !round) {
    console.error('[start] Round insert error:', roundError)
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
    return NextResponse.json({ error: 'Failed to deal hands' }, { status: 500 })
  }

  // Update room — triggers WaitingRoom Realtime redirect for all players
  await admin
    .from('rooms')
    .update({ status: 'in_progress', current_game_id: game.id })
    .eq('id', room.id)

  return NextResponse.json({ gameId: game.id }, { status: 200 })
}
