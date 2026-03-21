import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse, type NextRequest } from 'next/server'
import {
  getValidBids, getStartingBidderIndex,
  validatePlay, getLeadSuit, getTrickWinner,
  dealHands, drawTrump, scoreRound, determinePlacements,
} from '@/lib/game/gameRules'
import { CARD_RANK } from '@/lib/game/types'
import type { Card, Suit, CardValue, TrickCard } from '@/lib/game/types'

// Grace window: allow calls up to 1500ms before the computed expiry to
// account for clock skew between client and server.
const CLOCK_SKEW_MS = 1500

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

  // Fetch room for turn_timer_seconds
  const { data: room } = await admin
    .from('rooms')
    .select('turn_timer_seconds')
    .eq('id', game.room_id)
    .maybeSingle()

  if (!room || room.turn_timer_seconds === null) {
    return NextResponse.json({ error: 'Turn timer not configured for this room' }, { status: 422 })
  }

  // Verify caller is an active player in this game's room
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

  // Fetch current active round (bidding or playing)
  const { data: round } = await admin
    .from('rounds')
    .select('id, round_number, hand_size, status, current_player_id, trump_suit, turn_started_at')
    .eq('game_id', gameId)
    .in('status', ['bidding', 'playing'])
    .order('round_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!round || !round.turn_started_at || !round.current_player_id) {
    return NextResponse.json({ error: 'No active round' }, { status: 422 })
  }

  // Check whether the timer has genuinely expired
  const expiredAt = new Date(round.turn_started_at).getTime() + room.turn_timer_seconds * 1000
  if (Date.now() < expiredAt - CLOCK_SKEW_MS) {
    return NextResponse.json({ status: 'not_expired' }, { status: 200 })
  }

  // Safe: current_player_id and turn_started_at are guaranteed non-null by the guard above
  const activeRound = round as typeof round & { current_player_id: string; turn_started_at: string }

  if (round.status === 'bidding') {
    return autoResolveBid(admin, gameId, game.room_id, activeRound)
  }
  return autoResolvePlay(admin, gameId, game.room_id, activeRound)
}

// ─── Auto-resolve bidding turn ────────────────────────────────────────────────

async function autoResolveBid(
  admin: ReturnType<typeof createAdminClient>,
  gameId: string,
  roomId: string,
  round: { id: string; round_number: number; hand_size: number; current_player_id: string },
) {
  const { data: players } = await admin
    .from('room_players')
    .select('user_id, seat_order')
    .eq('room_id', roomId)
    .eq('status', 'active')
    .order('seat_order', { ascending: true })

  if (!players || players.length === 0) {
    return NextResponse.json({ error: 'No players found' }, { status: 500 })
  }

  const { data: existingBids } = await admin
    .from('bids')
    .select('amount')
    .eq('round_id', round.id)

  const existingAmounts = (existingBids ?? []).map((b) => b.amount)
  const isLastBidder = existingAmounts.length === players.length - 1
  const validBids = getValidBids(round.hand_size, existingAmounts, isLastBidder)
  const autoBid = Math.min(...validBids)

  const { error: bidError } = await admin
    .from('bids')
    .insert({ round_id: round.id, player_id: round.current_player_id, amount: autoBid })

  if (bidError) {
    console.error('[expire-turn/bid] Insert error:', bidError)
    return NextResponse.json({ error: 'Failed to record auto-bid' }, { status: 500 })
  }

  if (isLastBidder) {
    // All bids in — transition to playing (same logic as bid/route.ts)
    let leadingPlayerId: string
    if (round.round_number === 1) {
      leadingPlayerId = players[getStartingBidderIndex(round.round_number, players.length)].user_id
    } else {
      const { data: prevRound } = await admin
        .from('rounds')
        .select('id')
        .eq('game_id', gameId)
        .eq('round_number', round.round_number - 1)
        .maybeSingle()

      const { data: lastTrick } = prevRound
        ? await admin
            .from('tricks')
            .select('winner_id')
            .eq('round_id', prevRound.id)
            .not('winner_id', 'is', null)
            .order('trick_number', { ascending: false })
            .limit(1)
            .maybeSingle()
        : { data: null }

      leadingPlayerId = lastTrick?.winner_id
        ?? players[getStartingBidderIndex(round.round_number, players.length)].user_id
    }

    await admin
      .from('rounds')
      .update({ status: 'playing', current_player_id: leadingPlayerId, turn_started_at: new Date().toISOString() })
      .eq('id', round.id)

    await admin
      .from('tricks')
      .insert({ round_id: round.id, trick_number: 1 })

    return NextResponse.json({ status: 'playing' }, { status: 200 })
  }

  // Advance to next bidder in seat order
  const currentIndex = players.findIndex((p) => p.user_id === round.current_player_id)
  const nextPlayerId = players[(currentIndex + 1) % players.length].user_id

  await admin
    .from('rounds')
    .update({ current_player_id: nextPlayerId, turn_started_at: new Date().toISOString() })
    .eq('id', round.id)

  return NextResponse.json({ status: 'bidding' }, { status: 200 })
}

// ─── Auto-resolve playing turn ────────────────────────────────────────────────

function pickLowestLegalCard(hand: Card[], leadSuit: Suit | null): Card {
  if (leadSuit) {
    const suitCards = hand.filter((c) => c.suit === leadSuit)
    if (suitCards.length > 0) {
      return suitCards.reduce((low, c) => CARD_RANK[c.value] < CARD_RANK[low.value] ? c : low)
    }
  }
  return hand.reduce((low, c) => CARD_RANK[c.value] < CARD_RANK[low.value] ? c : low)
}

async function autoResolvePlay(
  admin: ReturnType<typeof createAdminClient>,
  gameId: string,
  roomId: string,
  round: { id: string; round_number: number; hand_size: number; current_player_id: string; trump_suit: string },
) {
  const { data: players } = await admin
    .from('room_players')
    .select('user_id, seat_order')
    .eq('room_id', roomId)
    .eq('status', 'active')
    .order('seat_order', { ascending: true })

  if (!players || players.length === 0) {
    return NextResponse.json({ error: 'No players found' }, { status: 500 })
  }

  // Fetch all tricks for this round
  const { data: allTricks } = await admin
    .from('tricks')
    .select('id, trick_number, led_suit, winner_id')
    .eq('round_id', round.id)
    .order('trick_number', { ascending: true })

  const currentTrick = [...(allTricks ?? [])].reverse().find((t) => t.winner_id === null) ?? null
  if (!currentTrick) {
    return NextResponse.json({ error: 'No active trick' }, { status: 422 })
  }

  // Compute current player's hand
  const trickIds = (allTricks ?? []).map((t) => t.id)
  const { data: handRow } = await admin
    .from('hands')
    .select('cards')
    .eq('round_id', round.id)
    .eq('player_id', round.current_player_id)
    .maybeSingle()

  if (!handRow) {
    return NextResponse.json({ error: 'Hand not found' }, { status: 500 })
  }

  const { data: playedByPlayer } = trickIds.length > 0
    ? await admin
        .from('trick_cards')
        .select('suit, value')
        .eq('player_id', round.current_player_id)
        .in('trick_id', trickIds)
    : { data: [] }

  const playedSet = new Set((playedByPlayer ?? []).map((c) => `${c.suit}:${c.value}`))
  const currentHand: Card[] = (handRow.cards as Card[]).filter(
    (c) => !playedSet.has(`${c.suit}:${c.value}`)
  )

  // Fetch cards already in the current trick
  const { data: existingTrickCards } = await admin
    .from('trick_cards')
    .select('player_id, suit, value')
    .eq('trick_id', currentTrick.id)

  const leadSuit = (currentTrick.led_suit ?? null) as Suit | null
  const autoCard = pickLowestLegalCard(currentHand, leadSuit)

  // Insert the auto-played card
  const { error: insertError } = await admin
    .from('trick_cards')
    .insert({
      trick_id: currentTrick.id,
      player_id: round.current_player_id,
      suit: autoCard.suit,
      value: autoCard.value,
    })

  if (insertError) {
    console.error('[expire-turn/play] trick_card insert error:', insertError)
    return NextResponse.json({ error: 'Failed to record auto-play' }, { status: 500 })
  }

  // Set led_suit when this is the first card in the trick
  if ((existingTrickCards ?? []).length === 0) {
    await admin
      .from('tricks')
      .update({ led_suit: autoCard.suit })
      .eq('id', currentTrick.id)
  }

  const totalPlayed = (existingTrickCards?.length ?? 0) + 1

  if (totalPlayed < players.length) {
    // Trick still in progress — advance to next player
    const currentIdx = players.findIndex((p) => p.user_id === round.current_player_id)
    const nextPlayerId = players[(currentIdx + 1) % players.length].user_id
    await admin
      .from('rounds')
      .update({ current_player_id: nextPlayerId, turn_started_at: new Date().toISOString() })
      .eq('id', round.id)
    return NextResponse.json({ status: 'trick_in_progress' }, { status: 200 })
  }

  // All players played — determine trick winner
  const allCards: TrickCard[] = [
    ...(existingTrickCards ?? []).map((tc) => ({
      playerId: tc.player_id,
      suit: tc.suit as Suit,
      value: tc.value as CardValue,
    })),
    { playerId: round.current_player_id, suit: autoCard.suit, value: autoCard.value },
  ]

  const effectiveLead = (currentTrick.led_suit ?? autoCard.suit) as Suit
  const winnerId = getTrickWinner(allCards, round.trump_suit as Suit, effectiveLead)

  await admin.from('tricks').update({ winner_id: winnerId }).eq('id', currentTrick.id)
  await admin
    .from('rounds')
    .update({ current_player_id: winnerId, turn_started_at: new Date().toISOString() })
    .eq('id', round.id)

  if (currentTrick.trick_number < round.hand_size) {
    await admin
      .from('tricks')
      .insert({ round_id: round.id, trick_number: currentTrick.trick_number + 1 })
    return NextResponse.json({ status: 'trick_complete', winnerId }, { status: 200 })
  }

  // ── All tricks done — score this round (identical to play/route.ts) ─────────

  const { data: roundBids } = await admin
    .from('bids')
    .select('player_id, amount')
    .eq('round_id', round.id)

  const bidsRecord: Record<string, number> = Object.fromEntries(
    (roundBids ?? []).map((b) => [b.player_id, b.amount])
  )

  const { data: completedTricks } = await admin
    .from('tricks')
    .select('winner_id')
    .eq('round_id', round.id)
    .not('winner_id', 'is', null)

  const tricksWonRecord: Record<string, number> = {}
  for (const trick of completedTricks ?? []) {
    if (trick.winner_id) {
      tricksWonRecord[trick.winner_id] = (tricksWonRecord[trick.winner_id] ?? 0) + 1
    }
  }
  for (const p of players) {
    if (!(p.user_id in tricksWonRecord)) tricksWonRecord[p.user_id] = 0
  }

  const roundScores = scoreRound(bidsRecord, tricksWonRecord)

  await admin.from('round_scores').insert(
    Object.entries(roundScores).map(([playerId, score]) => ({
      round_id: round.id,
      player_id: playerId,
      score,
      bid: bidsRecord[playerId] ?? 0,
      tricks_won: tricksWonRecord[playerId] ?? 0,
    }))
  )

  await admin
    .from('rounds')
    .update({ status: 'complete', current_player_id: null })
    .eq('id', round.id)

  if (round.hand_size > 1) {
    const nextHandSize = round.hand_size - 1
    const nextRoundNumber = round.round_number + 1
    const playerIds = players.map((p) => p.user_id)

    const { hands, remaining } = dealHands(playerIds, nextHandSize)
    const { trumpCard, trumpSuit } = drawTrump(remaining)

    const { data: nextRound } = await admin
      .from('rounds')
      .insert({
        game_id: gameId,
        round_number: nextRoundNumber,
        hand_size: nextHandSize,
        trump_suit: trumpSuit,
        trump_card_value: trumpCard.value,
        status: 'bidding',
        current_player_id: winnerId,
        turn_started_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (nextRound) {
      await admin.from('hands').insert(
        playerIds.map((playerId) => ({
          round_id: nextRound.id,
          player_id: playerId,
          cards: hands[playerId],
        }))
      )
    }

    return NextResponse.json({ status: 'round_complete', winnerId }, { status: 200 })
  }

  // ── Last round — end game ──────────────────────────────────────────────────

  const { data: allGameRoundIds } = await admin
    .from('rounds')
    .select('id')
    .eq('game_id', gameId)

  const allRoundIds = (allGameRoundIds ?? []).map((r) => r.id)

  const { data: allRoundScores } = await admin
    .from('round_scores')
    .select('player_id, score')
    .in('round_id', allRoundIds)

  const totalScores: Record<string, number> = {}
  for (const rs of allRoundScores ?? []) {
    totalScores[rs.player_id] = (totalScores[rs.player_id] ?? 0) + rs.score
  }

  const placements = determinePlacements(totalScores)

  await admin.from('game_results').insert(
    placements.map((p) => ({
      game_id: gameId,
      player_id: p.playerId,
      placement: p.placement,
      result: p.result,
      total_score: totalScores[p.playerId],
    }))
  )

  await admin.from('games').update({ status: 'finished' }).eq('id', gameId)

  return NextResponse.json({ status: 'game_complete', winnerId }, { status: 200 })
}
