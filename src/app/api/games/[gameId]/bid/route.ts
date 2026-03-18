import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse, type NextRequest } from 'next/server'
import { getValidBids, validateBid } from '@/lib/game/gameRules'

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
  let amount: number
  try {
    const body = await request.json()
    amount = body.amount
    if (typeof amount !== 'number') throw new Error()
  } catch {
    return NextResponse.json({ error: 'amount must be a number' }, { status: 400 })
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

  // Verify player is active in this game's room
  const { data: roomPlayer } = await admin
    .from('room_players')
    .select('id')
    .eq('room_id', game.room_id)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle()

  if (!roomPlayer) {
    return NextResponse.json({ error: 'Not a player in this game' }, { status: 403 })
  }

  // Fetch current bidding round
  const { data: round } = await admin
    .from('rounds')
    .select('id, round_number, hand_size, status, current_player_id')
    .eq('game_id', gameId)
    .eq('status', 'bidding')
    .order('round_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!round) {
    return NextResponse.json({ error: 'No active bidding round' }, { status: 422 })
  }

  if (round.current_player_id !== user.id) {
    return NextResponse.json({ error: 'Not your turn' }, { status: 422 })
  }

  // Fetch all active players ordered by seat
  const { data: players } = await admin
    .from('room_players')
    .select('user_id, seat_order')
    .eq('room_id', game.room_id)
    .eq('status', 'active')
    .order('seat_order', { ascending: true })

  if (!players || players.length === 0) {
    return NextResponse.json({ error: 'No players found' }, { status: 500 })
  }

  // Fetch existing bids for this round
  const { data: existingBids } = await admin
    .from('bids')
    .select('amount')
    .eq('round_id', round.id)

  const existingAmounts = (existingBids ?? []).map((b) => b.amount)
  const isLastBidder = existingAmounts.length === players.length - 1
  const validBids = getValidBids(round.hand_size, existingAmounts, isLastBidder)

  if (!validateBid(amount, validBids)) {
    const forbidden = isLastBidder ? round.hand_size - existingAmounts.reduce((s, a) => s + a, 0) : null
    return NextResponse.json(
      { error: 'Invalid bid', forbidden },
      { status: 422 }
    )
  }

  // Insert bid
  const { error: bidError } = await admin
    .from('bids')
    .insert({ round_id: round.id, player_id: user.id, amount })

  if (bidError) {
    console.error('[bid] Insert error:', bidError)
    return NextResponse.json({ error: 'Failed to record bid' }, { status: 500 })
  }

  if (isLastBidder) {
    // All bids in — transition round to playing, insert first trick
    const startingIndex = (round.round_number - 1) % players.length
    const leadingPlayerId = players[startingIndex].user_id

    const { error: roundError } = await admin
      .from('rounds')
      .update({ status: 'playing', current_player_id: leadingPlayerId })
      .eq('id', round.id)

    if (roundError) {
      console.error('[bid] Round update error:', roundError)
      return NextResponse.json({ error: 'Failed to start playing phase' }, { status: 500 })
    }

    const { error: trickError } = await admin
      .from('tricks')
      .insert({ round_id: round.id, trick_number: 1 })

    if (trickError) {
      console.error('[bid] Trick insert error:', trickError)
      return NextResponse.json({ error: 'Failed to create first trick' }, { status: 500 })
    }

    return NextResponse.json({ status: 'playing' }, { status: 200 })
  }

  // Advance to next bidder in seat order
  const currentIndex = players.findIndex((p) => p.user_id === user.id)
  const nextPlayerId = players[(currentIndex + 1) % players.length].user_id

  await admin
    .from('rounds')
    .update({ current_player_id: nextPlayerId })
    .eq('id', round.id)

  return NextResponse.json({ status: 'bidding' }, { status: 200 })
}
