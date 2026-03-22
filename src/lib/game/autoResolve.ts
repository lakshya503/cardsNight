import {
  getValidBids, getStartingBidderIndex,
  getTrickWinner, dealHands, drawTrump, scoreRound, determinePlacements,
} from '@/lib/game/gameRules'
import { CARD_RANK } from '@/lib/game/types'
import type { Card, Suit, CardValue, TrickCard } from '@/lib/game/types'
import type { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>

export type AutoResolveResult =
  | { ok: true; status: string; winnerId?: string }
  | { ok: false; error: string; httpStatus: number }

// ─── pickLowestLegalCard ────────────────────────────────────────────────────────

export function pickLowestLegalCard(hand: Card[], leadSuit: Suit | null): Card {
  if (leadSuit) {
    const suitCards = hand.filter((c) => c.suit === leadSuit)
    if (suitCards.length > 0) {
      return suitCards.reduce((low, c) => CARD_RANK[c.value] < CARD_RANK[low.value] ? c : low)
    }
  }
  return hand.reduce((low, c) => CARD_RANK[c.value] < CARD_RANK[low.value] ? c : low)
}

// ─── autoResolveBid ────────────────────────────────────────────────────────────

export async function autoResolveBid(
  admin: AdminClient,
  gameId: string,
  roomId: string,
  round: { id: string; round_number: number; hand_size: number; current_player_id: string },
): Promise<AutoResolveResult> {
  // 1. Get all player IDs who have a hand this round
  const { data: handRows } = await admin.from('hands').select('player_id').eq('round_id', round.id)
  const roundPlayerIds = (handRows ?? []).map((h) => h.player_id)

  if (roundPlayerIds.length === 0) {
    return { ok: false, error: 'No players found', httpStatus: 500 }
  }

  // 2. Get their room_player records (seat order + current status)
  const { data: players } = await admin
    .from('room_players').select('user_id, seat_order, status')
    .eq('room_id', roomId).in('user_id', roundPlayerIds)
    .order('seat_order', { ascending: true })

  if (!players || players.length === 0) {
    return { ok: false, error: 'No players found', httpStatus: 500 }
  }

  // activePlayers: non-dropped players only — used for completion thresholds.
  // players (allPlayers): full seat list — used for turn advancement wraparound.
  const activePlayers = players.filter((p) => p.status !== 'dropped')

  const { data: existingBids } = await admin
    .from('bids')
    .select('amount')
    .eq('round_id', round.id)

  const existingAmounts = (existingBids ?? []).map((b) => b.amount)
  // isLastBidder uses activePlayers.length - 1: dropped players never bid,
  // so the threshold is the number of active players, not the full round seat count.
  const isLastBidder = existingAmounts.length === activePlayers.length - 1
  const validBids = getValidBids(round.hand_size, existingAmounts, isLastBidder)
  const autoBid = Math.min(...validBids)

  const { error: bidError } = await admin
    .from('bids')
    .insert({ round_id: round.id, player_id: round.current_player_id, amount: autoBid })

  if (bidError) {
    console.error('[autoResolveBid] Insert error:', bidError)
    return { ok: false, error: 'Failed to record auto-bid', httpStatus: 500 }
  }

  if (isLastBidder) {
    // All bids in — transition to playing
    // Only non-dropped players are eligible leaders
    const eligibleLeaders = players.filter((p) => p.status !== 'dropped')
    let leadingPlayerId: string

    if (round.round_number === 1) {
      const leaderIdx = getStartingBidderIndex(round.round_number, eligibleLeaders.length)
      leadingPlayerId = eligibleLeaders[leaderIdx % eligibleLeaders.length].user_id
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

      // If last trick winner is now dropped, fall back to first eligible leader
      const winnerId = lastTrick?.winner_id
      const isWinnerEligible = eligibleLeaders.some((p) => p.user_id === winnerId)
      leadingPlayerId = (winnerId && isWinnerEligible)
        ? winnerId
        : eligibleLeaders[getStartingBidderIndex(round.round_number, eligibleLeaders.length) % eligibleLeaders.length].user_id
    }

    await admin
      .from('rounds')
      .update({ status: 'playing', current_player_id: leadingPlayerId, turn_started_at: new Date().toISOString() })
      .eq('id', round.id)

    await admin
      .from('tricks')
      .insert({ round_id: round.id, trick_number: 1 })

    return { ok: true, status: 'playing' }
  }

  // Advance to next bidder in seat order (do NOT skip dropped players — chain handles consecutive drops)
  const currentIndex = players.findIndex((p) => p.user_id === round.current_player_id)
  const nextPlayerId = players[(currentIndex + 1) % players.length].user_id

  await admin
    .from('rounds')
    .update({ current_player_id: nextPlayerId, turn_started_at: new Date().toISOString() })
    .eq('id', round.id)

  return { ok: true, status: 'bidding' }
}

// ─── autoResolvePlay ────────────────────────────────────────────────────────────

export async function autoResolvePlay(
  admin: AdminClient,
  gameId: string,
  roomId: string,
  round: { id: string; round_number: number; hand_size: number; current_player_id: string; trump_suit: string },
): Promise<AutoResolveResult> {
  // 1. Get all player IDs who have a hand this round
  const { data: handRows } = await admin.from('hands').select('player_id').eq('round_id', round.id)
  const roundPlayerIds = (handRows ?? []).map((h) => h.player_id)

  if (roundPlayerIds.length === 0) {
    return { ok: false, error: 'No players found', httpStatus: 500 }
  }

  // 2. Get their room_player records (seat order + current status)
  const { data: players } = await admin
    .from('room_players').select('user_id, seat_order, status')
    .eq('room_id', roomId).in('user_id', roundPlayerIds)
    .order('seat_order', { ascending: true })

  if (!players || players.length === 0) {
    return { ok: false, error: 'No players found', httpStatus: 500 }
  }

  // activePlayers: non-dropped only — used for trick/bid completion thresholds.
  // players (allPlayers): full seat list — used for turn advancement wraparound.
  const activePlayers = players.filter((p) => p.status !== 'dropped')

  // Fetch all tricks for this round
  const { data: allTricks } = await admin
    .from('tricks')
    .select('id, trick_number, led_suit, winner_id')
    .eq('round_id', round.id)
    .order('trick_number', { ascending: true })

  const currentTrick = [...(allTricks ?? [])].reverse().find((t) => t.winner_id === null) ?? null
  if (!currentTrick) {
    return { ok: false, error: 'No active trick', httpStatus: 422 }
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
    return { ok: false, error: 'Hand not found', httpStatus: 500 }
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
    console.error('[autoResolvePlay] trick_card insert error:', insertError)
    return { ok: false, error: 'Failed to record auto-play', httpStatus: 500 }
  }

  // Set led_suit when this is the first card in the trick
  if ((existingTrickCards ?? []).length === 0) {
    await admin
      .from('tricks')
      .update({ led_suit: autoCard.suit })
      .eq('id', currentTrick.id)
  }

  const totalPlayed = (existingTrickCards?.length ?? 0) + 1

  // Trick still in progress — advance to next player (do NOT skip dropped players).
  // Completion threshold uses activePlayers.length: dropped players never play a card,
  // so the trick is complete when all *active* players have played.
  // Turn advancement still uses players (full seat list) for correct index wraparound.
  if (totalPlayed < activePlayers.length) {
    const currentIdx = players.findIndex((p) => p.user_id === round.current_player_id)
    const nextPlayerId = players[(currentIdx + 1) % players.length].user_id
    await admin
      .from('rounds')
      .update({ current_player_id: nextPlayerId, turn_started_at: new Date().toISOString() })
      .eq('id', round.id)
    return { ok: true, status: 'trick_in_progress' }
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
    return { ok: true, status: 'trick_complete', winnerId }
  }

  // ── All tricks done — score this round ─────────────────────────────────────

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

  // Insert round_scores for non-dropped players only
  // (disconnected-but-not-dropped players still earn scores)
  await admin.from('round_scores').insert(
    Object.entries(roundScores)
      .filter(([playerId]) => players.some((p) => p.user_id === playerId && p.status !== 'dropped'))
      .map(([playerId, score]) => ({
        round_id: round.id,
        player_id: playerId,
        score,
        bid: bidsRecord[playerId] ?? 0,
        tricks_won: tricksWonRecord[playerId] ?? 0,
      }))
  )

  await admin
    .from('rounds')
    .update({ status: 'complete', current_player_id: null, turn_started_at: null })
    .eq('id', round.id)

  if (round.hand_size > 1) {
    const nextHandSize = round.hand_size - 1
    const nextRoundNumber = round.round_number + 1
    // Next round deals only to non-dropped players
    const activePlayers = players.filter((p) => p.status !== 'dropped')
    const playerIds = activePlayers.map((p) => p.user_id)

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

    return { ok: true, status: 'round_complete', winnerId }
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

  // Only insert for non-dropped players to avoid double-inserting for players
  // already handled by the drop-player route
  const nonDroppedIds = new Set(players.filter((p) => p.status !== 'dropped').map((p) => p.user_id))

  await admin.from('game_results').insert(
    placements
      .filter((p) => nonDroppedIds.has(p.playerId))
      .map((p) => ({
        game_id: gameId,
        player_id: p.playerId,
        placement: p.placement,
        result: p.result,
        total_score: totalScores[p.playerId],
      }))
  )

  await admin.from('games').update({ status: 'finished' }).eq('id', gameId)

  return { ok: true, status: 'game_complete', winnerId }
}

// ─── resolveDroppedTurnChain ────────────────────────────────────────────────────

export async function resolveDroppedTurnChain(
  admin: AdminClient,
  gameId: string,
  roomId: string,
): Promise<void> {
  // Loop up to 10 iterations (safety cap = max players)
  for (let i = 0; i < 10; i++) {
    // 1. Fetch current active round
    const { data: round } = await admin
      .from('rounds')
      .select('id, round_number, hand_size, status, current_player_id, trump_suit, turn_started_at')
      .eq('game_id', gameId)
      .in('status', ['bidding', 'playing'])
      .order('round_number', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!round || !round.current_player_id || !round.turn_started_at) break

    // 2. Check if current_player_id has status='dropped'
    const { data: currentPlayerRecord } = await admin
      .from('room_players')
      .select('status')
      .eq('room_id', roomId)
      .eq('user_id', round.current_player_id)
      .maybeSingle()

    if (currentPlayerRecord?.status !== 'dropped') break

    // 4. Atomically claim the turn (same lock pattern as expire-turn route)
    const { data: claimed } = await admin
      .from('rounds')
      .update({ turn_started_at: new Date().toISOString() })
      .eq('id', round.id)
      .eq('turn_started_at', round.turn_started_at)
      .select('id')

    // 5. If claim fails (0 rows), break (another caller won the race)
    if (!claimed || claimed.length === 0) break

    const activeRound = round as typeof round & {
      current_player_id: string
      turn_started_at: string
      trump_suit: string
    }

    // 6. Call autoResolveBid or autoResolvePlay
    let result: AutoResolveResult
    if (round.status === 'bidding') {
      result = await autoResolveBid(admin, gameId, roomId, activeRound)
    } else {
      result = await autoResolvePlay(admin, gameId, roomId, activeRound)
    }

    // 7. If result is round_complete or game_complete, break
    if (!result.ok) break
    if (result.status === 'round_complete' || result.status === 'game_complete') break

    // 8. Otherwise loop again to check if the new current player is also dropped
  }
}
