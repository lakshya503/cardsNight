import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse, type NextRequest } from 'next/server'
import {
  validatePlay, getLeadSuit, getTrickWinner,
  dealHands, drawTrump, scoreRound, determinePlacements,
} from '@/lib/game/gameRules'
import { getPlayerHand } from '@/lib/game/server'
import type { Card, Suit, CardValue, TrickCard } from '@/lib/game/types'

const VALID_SUITS: Suit[] = ['hearts', 'diamonds', 'clubs', 'spades']
const VALID_VALUES: CardValue[] = ['2','3','4','5','6','7','8','9','10','J','Q','K','A']

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
  let suit: string, value: string
  try {
    const body = await request.json()
    suit = body.suit
    value = body.value
    if (!VALID_SUITS.includes(suit as Suit) || !VALID_VALUES.includes(value as CardValue)) throw new Error()
  } catch {
    return NextResponse.json({ error: 'suit and value must be strings' }, { status: 400 })
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

  // Fetch current playing round
  const { data: round } = await admin
    .from('rounds')
    .select('id, round_number, hand_size, trump_suit, status, current_player_id')
    .eq('game_id', gameId)
    .eq('status', 'playing')
    .order('round_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!round) {
    return NextResponse.json({ error: 'No active playing round' }, { status: 422 })
  }

  if (round.current_player_id !== user.id) {
    return NextResponse.json({ error: 'Not your turn' }, { status: 422 })
  }

  // Fetch all active players in seat order
  const { data: players } = await admin
    .from('room_players')
    .select('user_id, seat_order')
    .eq('room_id', game.room_id)
    .eq('status', 'active')
    .order('seat_order', { ascending: true })

  if (!players || players.length === 0) {
    return NextResponse.json({ error: 'No players found' }, { status: 500 })
  }

  // Fetch all tricks for this round to find the current active trick
  // and to compute the player's current hand
  const { data: allTricks } = await admin
    .from('tricks')
    .select('id, trick_number, led_suit, winner_id')
    .eq('round_id', round.id)
    .order('trick_number', { ascending: true })

  const currentTrick = [...(allTricks ?? [])].reverse().find((t) => t.winner_id === null) ?? null

  if (!currentTrick) {
    return NextResponse.json({ error: 'No active trick' }, { status: 422 })
  }

  // Compute player's current hand
  const trickIds = (allTricks ?? []).map((t) => t.id)
  const { data: handRow } = await admin
    .from('hands')
    .select('cards')
    .eq('round_id', round.id)
    .eq('player_id', user.id)
    .maybeSingle()

  if (!handRow) {
    return NextResponse.json({ error: 'Hand not found' }, { status: 500 })
  }

  const { data: playedByPlayer } = trickIds.length > 0
    ? await admin
        .from('trick_cards')
        .select('suit, value')
        .eq('player_id', user.id)
        .in('trick_id', trickIds)
    : { data: [] }

  const playedSet = new Set((playedByPlayer ?? []).map((c) => `${c.suit}:${c.value}`))
  const currentHand: Card[] = (handRow.cards as Card[]).filter(
    (c) => !playedSet.has(`${c.suit}:${c.value}`)
  )

  // Fetch cards already played in the current trick
  const { data: existingTrickCards } = await admin
    .from('trick_cards')
    .select('player_id, suit, value')
    .eq('trick_id', currentTrick.id)

  const leadSuit = getLeadSuit(
    (existingTrickCards ?? []).map((tc) => ({
      playerId: tc.player_id,
      suit: tc.suit as Suit,
      value: tc.value as CardValue,
    }))
  )

  const card: Card = { suit: suit as Suit, value: value as CardValue }

  if (!validatePlay(card, currentHand, leadSuit)) {
    return NextResponse.json({ error: 'Invalid play' }, { status: 422 })
  }

  // Insert trick_card
  const { error: insertError } = await admin
    .from('trick_cards')
    .insert({ trick_id: currentTrick.id, player_id: user.id, suit: card.suit, value: card.value })

  if (insertError) {
    console.error('[play] trick_card insert error:', insertError)
    return NextResponse.json({ error: 'Failed to record play' }, { status: 500 })
  }

  // Set led_suit on the trick when the first card is played
  if ((existingTrickCards ?? []).length === 0) {
    const { error: ledSuitError } = await admin
      .from('tricks')
      .update({ led_suit: card.suit })
      .eq('id', currentTrick.id)
    if (ledSuitError) {
      console.error('[play] led_suit update error:', ledSuitError)
      return NextResponse.json({ error: 'Failed to record led suit' }, { status: 500 })
    }
  }

  const totalPlayed = (existingTrickCards?.length ?? 0) + 1

  if (totalPlayed < players.length) {
    // Trick still in progress — advance to next player in seat order
    const currentIdx = players.findIndex((p) => p.user_id === user.id)
    const nextPlayerId = players[(currentIdx + 1) % players.length].user_id
    const { error: advanceError } = await admin
      .from('rounds')
      .update({ current_player_id: nextPlayerId, turn_started_at: new Date().toISOString() })
      .eq('id', round.id)
    if (advanceError) {
      console.error('[play] advance turn error:', advanceError)
      return NextResponse.json({ error: 'Failed to advance turn' }, { status: 500 })
    }
    return NextResponse.json({ status: 'trick_in_progress' }, { status: 200 })
  }

  // All players have played — determine trick winner
  const allCards: TrickCard[] = [
    ...(existingTrickCards ?? []).map((tc) => ({
      playerId: tc.player_id,
      suit: tc.suit as Suit,
      value: tc.value as CardValue,
    })),
    { playerId: user.id, suit: card.suit, value: card.value },
  ]

  const effectiveLead = (currentTrick.led_suit ?? card.suit) as Suit
  const winnerId = getTrickWinner(allCards, round.trump_suit as Suit, effectiveLead)

  const { error: trickWinError } = await admin
    .from('tricks')
    .update({ winner_id: winnerId })
    .eq('id', currentTrick.id)

  if (trickWinError) {
    console.error('[play] trick winner update error:', trickWinError)
    return NextResponse.json({ error: 'Failed to record trick winner' }, { status: 500 })
  }

  const { error: trickLeaderError } = await admin
    .from('rounds')
    .update({ current_player_id: winnerId, turn_started_at: new Date().toISOString() })
    .eq('id', round.id)

  if (trickLeaderError) {
    console.error('[play] trick leader update error:', trickLeaderError)
    return NextResponse.json({ error: 'Failed to update round leader' }, { status: 500 })
  }

  // Insert next trick or transition round to complete
  if (currentTrick.trick_number < round.hand_size) {
    const { error: nextTrickError } = await admin
      .from('tricks')
      .insert({ round_id: round.id, trick_number: currentTrick.trick_number + 1 })
    if (nextTrickError) {
      console.error('[play] next trick insert error:', nextTrickError)
      return NextResponse.json({ error: 'Failed to create next trick' }, { status: 500 })
    }
    return NextResponse.json({ status: 'trick_complete', winnerId }, { status: 200 })
  }

  // ── All tricks done — score this round ─────────────────────────────────────

  // Tally bids
  const { data: roundBids } = await admin
    .from('bids')
    .select('player_id, amount')
    .eq('round_id', round.id)

  const bidsRecord: Record<string, number> = Object.fromEntries(
    (roundBids ?? []).map((b) => [b.player_id, b.amount])
  )

  // Tally tricks won (winner_id is now set on all tricks including the one just completed)
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
  // Ensure all players have an entry (0 tricks won is a valid outcome)
  for (const p of players) {
    if (!(p.user_id in tricksWonRecord)) tricksWonRecord[p.user_id] = 0
  }

  const roundScores = scoreRound(bidsRecord, tricksWonRecord)

  // Insert round_scores
  const { error: rsError } = await admin.from('round_scores').insert(
    Object.entries(roundScores).map(([playerId, score]) => ({
      round_id: round.id,
      player_id: playerId,
      score,
      bid: bidsRecord[playerId] ?? 0,
      tricks_won: tricksWonRecord[playerId] ?? 0,
    }))
  )

  if (rsError) {
    console.error('[play] round_scores insert error:', rsError)
    return NextResponse.json({ error: 'Failed to record round scores' }, { status: 500 })
  }

  // Mark this round complete
  const { error: roundCompleteError } = await admin
    .from('rounds')
    .update({ status: 'complete', current_player_id: null })
    .eq('id', round.id)

  if (roundCompleteError) {
    console.error('[play] round complete update error:', roundCompleteError)
    return NextResponse.json({ error: 'Failed to complete round' }, { status: 500 })
  }

  // ── Start next round or end game ─────────────────────────────────────────

  if (round.hand_size > 1) {
    // Deal next round
    const nextHandSize = round.hand_size - 1
    const nextRoundNumber = round.round_number + 1
    const playerIds = players.map((p) => p.user_id)
    const nextBidderId = winnerId

    const { hands, remaining } = dealHands(playerIds, nextHandSize)
    const { trumpCard, trumpSuit } = drawTrump(remaining)

    const { data: nextRound, error: nextRoundError } = await admin
      .from('rounds')
      .insert({
        game_id: gameId,
        round_number: nextRoundNumber,
        hand_size: nextHandSize,
        trump_suit: trumpSuit,
        trump_card_value: trumpCard.value,
        status: 'bidding',
        current_player_id: nextBidderId,
        turn_started_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (nextRoundError || !nextRound) {
      console.error('[play] next round insert error:', nextRoundError)
      return NextResponse.json({ error: 'Failed to start next round' }, { status: 500 })
    }

    const { error: handsError } = await admin.from('hands').insert(
      playerIds.map((playerId) => ({
        round_id: nextRound.id,
        player_id: playerId,
        cards: hands[playerId],
      }))
    )

    if (handsError) {
      console.error('[play] hands insert error:', handsError)
      return NextResponse.json({ error: 'Failed to deal next round hands' }, { status: 500 })
    }

    return NextResponse.json({ status: 'round_complete', winnerId }, { status: 200 })
  }

  // ── Last round — end game ──────────────────────────────────────────────────

  // Fetch all round scores for this game
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

  const { error: grError } = await admin.from('game_results').insert(
    placements.map((p) => ({
      game_id: gameId,
      player_id: p.playerId,
      placement: p.placement,
      result: p.result,
      total_score: totalScores[p.playerId],
    }))
  )

  if (grError) {
    console.error('[play] game_results insert error:', grError)
    return NextResponse.json({ error: 'Failed to record game results' }, { status: 500 })
  }

  const { error: gameFinishError } = await admin
    .from('games')
    .update({ status: 'finished' })
    .eq('id', gameId)

  if (gameFinishError) {
    console.error('[play] game finish update error:', gameFinishError)
    return NextResponse.json({ error: 'Failed to finish game' }, { status: 500 })
  }

  return NextResponse.json({ status: 'game_complete', winnerId }, { status: 200 })
}
