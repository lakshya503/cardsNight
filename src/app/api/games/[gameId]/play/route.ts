import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse, type NextRequest } from 'next/server'
import { validatePlay, getLeadSuit, getTrickWinner } from '@/lib/game/gameRules'
import { getPlayerHand } from '@/lib/game/server'
import type { Card, Suit, CardValue, TrickCard } from '@/lib/game/types'

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
    if (typeof suit !== 'string' || typeof value !== 'string') throw new Error()
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
    await admin
      .from('tricks')
      .update({ led_suit: card.suit })
      .eq('id', currentTrick.id)
  }

  const totalPlayed = (existingTrickCards?.length ?? 0) + 1

  if (totalPlayed < players.length) {
    // Trick still in progress — advance to next player in seat order
    const currentIdx = players.findIndex((p) => p.user_id === user.id)
    const nextPlayerId = players[(currentIdx + 1) % players.length].user_id
    await admin
      .from('rounds')
      .update({ current_player_id: nextPlayerId })
      .eq('id', round.id)
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

  await admin
    .from('tricks')
    .update({ winner_id: winnerId })
    .eq('id', currentTrick.id)

  await admin
    .from('rounds')
    .update({ current_player_id: winnerId })
    .eq('id', round.id)

  // Insert next trick or transition round to scoring
  if (currentTrick.trick_number < round.hand_size) {
    await admin
      .from('tricks')
      .insert({ round_id: round.id, trick_number: currentTrick.trick_number + 1 })
    return NextResponse.json({ status: 'trick_complete', winnerId }, { status: 200 })
  }

  // All tricks done — Slice 5 handles scoring; mark round as scoring
  await admin
    .from('rounds')
    .update({ status: 'scoring', current_player_id: null })
    .eq('id', round.id)

  return NextResponse.json({ status: 'round_complete', winnerId }, { status: 200 })
}
