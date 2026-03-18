import type { Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

/**
 * Creates a room via the API. The page must already be authenticated.
 * Returns the room code.
 */
export async function createRoom(page: Page): Promise<string> {
  const res = await page.request.post('/api/rooms', {
    data: { game_type: 'judgement', max_players: 2 },
  })
  if (!res.ok()) {
    throw new Error(`createRoom failed (${res.status()}): ${await res.text()}`)
  }
  const { code } = await res.json()
  return code as string
}

/**
 * Joins an existing room via the API. The page must already be authenticated.
 */
export async function joinRoom(page: Page, code: string): Promise<void> {
  const res = await page.request.post(`/api/rooms/${code}/join`)
  if (!res.ok()) {
    throw new Error(`joinRoom failed (${res.status()}): ${await res.text()}`)
  }
}

/**
 * Starts the game via the API. The page must be authenticated as the host.
 * Returns the gameId.
 */
export async function startGame(page: Page, code: string): Promise<string> {
  const res = await page.request.post(`/api/rooms/${code}/start`)
  if (!res.ok()) {
    throw new Error(`startGame failed (${res.status()}): ${await res.text()}`)
  }
  const { gameId } = await res.json()
  return gameId as string
}

/**
 * Places a bid via the API. The page must be authenticated as the current bidder.
 */
export async function placeBid(page: Page, gameId: string, amount: number): Promise<void> {
  const res = await page.request.post(`/api/games/${gameId}/bid`, { data: { amount } })
  if (!res.ok()) {
    throw new Error(`placeBid failed (${res.status()}): ${await res.text()}`)
  }
}

/**
 * Returns the player's remaining cards for the current round directly from the DB.
 * Replicates getPlayerHand (dealt minus played) without going through the HTTP API.
 * Uses the admin client — avoids auth overhead in tight loops (e.g. playFullGame).
 */
export async function getHandDirect(
  userId: string,
  roundId: string,
): Promise<Array<{ suit: string; value: string }>> {
  const admin = adminClient()

  const { data: handRow } = await admin
    .from('hands')
    .select('cards')
    .eq('round_id', roundId)
    .eq('player_id', userId)
    .maybeSingle()

  if (!handRow) return []

  const { data: roundTricks } = await admin
    .from('tricks')
    .select('id')
    .eq('round_id', roundId)

  const trickIds = (roundTricks ?? []).map((t: { id: string }) => t.id)
  if (trickIds.length === 0) return handRow.cards as Array<{ suit: string; value: string }>

  const { data: played } = await admin
    .from('trick_cards')
    .select('suit, value')
    .eq('player_id', userId)
    .in('trick_id', trickIds)

  const playedSet = new Set((played ?? []).map((c: { suit: string; value: string }) => `${c.suit}:${c.value}`))
  return (handRow.cards as Array<{ suit: string; value: string }>).filter(
    (c) => !playedSet.has(`${c.suit}:${c.value}`),
  )
}

/**
 * Returns the current (latest) round for a game, or null.
 */
export async function getCurrentRound(gameId: string) {
  const { data } = await adminClient()
    .from('rounds')
    .select('id, round_number, hand_size, status, current_player_id, trump_suit')
    .eq('game_id', gameId)
    .order('round_number', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data
}

/**
 * Returns the player's current hand via the /hand API endpoint.
 * Uses the authenticated page so session cookies are included.
 */
export async function getHand(
  page: Page,
  gameId: string,
): Promise<Array<{ suit: string; value: string }>> {
  const res = await page.request.get(`/api/games/${gameId}/hand`)
  if (!res.ok()) throw new Error(`getHand failed (${res.status()}): ${await res.text()}`)
  const { cards } = await res.json()
  return cards as Array<{ suit: string; value: string }>
}

/**
 * Deletes all database records for a room (identified by room code) in dependency order.
 * Call this in afterAll to keep the test database clean.
 *
 * FK cascade summary (from schema):
 *   rooms → room_players (CASCADE); everything else requires explicit ordered deletes.
 */
export async function cleanupRoom(code: string): Promise<void> {
  const admin = adminClient()

  // Resolve room
  const { data: room } = await admin.from('rooms').select('id').eq('code', code).maybeSingle()
  if (!room) return

  // Resolve games for this room
  const { data: games } = await admin.from('games').select('id').eq('room_id', room.id)
  const gameIds = (games ?? []).map((g: { id: string }) => g.id)

  if (gameIds.length > 0) {
    // Resolve rounds for these games
    const { data: rounds } = await admin.from('rounds').select('id').in('game_id', gameIds)
    const roundIds = (rounds ?? []).map((r: { id: string }) => r.id)

    if (roundIds.length > 0) {
      // Resolve tricks for these rounds
      const { data: tricks } = await admin.from('tricks').select('id').in('round_id', roundIds)
      const trickIds = (tricks ?? []).map((t: { id: string }) => t.id)

      if (trickIds.length > 0) {
        await admin.from('trick_cards').delete().in('trick_id', trickIds)
        await admin.from('tricks').delete().in('round_id', roundIds)
      }

      await admin.from('round_scores').delete().in('round_id', roundIds)
      await admin.from('bids').delete().in('round_id', roundIds)
      await admin.from('hands').delete().in('round_id', roundIds)
      await admin.from('rounds').delete().in('game_id', gameIds)
    }

    await admin.from('game_results').delete().in('game_id', gameIds)
    await admin.from('games').delete().in('room_id', [room.id])
  }

  // room_players cascade from rooms; delete room last
  await admin.from('rooms').delete().eq('id', room.id)
}

/**
 * Plays a card via the API. The page must be authenticated as the current player.
 * Retries once on 500 to handle transient Supabase connection drops.
 */
export async function playCard(
  page: Page,
  gameId: string,
  suit: string,
  value: string,
): Promise<{ status: string; winnerId?: string }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await page.request.post(`/api/games/${gameId}/play`, { data: { suit, value } })
    if (res.ok()) return res.json()
    const body = await res.text()
    if (res.status() !== 500 || attempt === 1) {
      throw new Error(`playCard failed (${res.status()}): ${body}`)
    }
    // 500 on first attempt — wait briefly and retry
    await new Promise((r) => setTimeout(r, 2000))
  }
  // unreachable
  throw new Error('playCard: unexpected loop exit')
}

/**
 * Plays through an entire game (all rounds) using API calls.
 * Each player bids 0 every round. Players pick a valid card (following suit when required).
 * playerIds must be in seat order (index 0 = seat 0).
 */
export async function playFullGame(
  pages: Record<string, Page>, // userId -> authenticated page
  gameId: string,
  playerIds: string[],         // in seat order
): Promise<void> {
  while (true) {
    const round = await getCurrentRound(gameId)
    if (!round || round.status === 'complete') break

    // ── Bidding phase ────────────────────────────────────────────────────────
    if (round.status === 'bidding') {
      let bidderId = round.current_player_id!
      for (let i = 0; i < playerIds.length; i++) {
        await placeBid(pages[bidderId], gameId, 0)
        const idx = playerIds.indexOf(bidderId)
        bidderId = playerIds[(idx + 1) % playerIds.length]
      }
    }

    // ── Playing phase ────────────────────────────────────────────────────────
    const playingRound = await getCurrentRound(gameId)
    if (!playingRound || playingRound.status !== 'playing') break

    let leaderId = playingRound.current_player_id!
    let roundEnded = false

    for (let trickNum = 0; trickNum < playingRound.hand_size && !roundEnded; trickNum++) {
      let leadSuit: string | null = null

      for (let cardIdx = 0; cardIdx < playerIds.length; cardIdx++) {
        // Players take turns in seat order starting from the trick leader
        const leaderIdx = playerIds.indexOf(leaderId)
        const currentPlayerId = playerIds[(leaderIdx + cardIdx) % playerIds.length]

        const hand = await getHandDirect(currentPlayerId, playingRound.id)

        // Follow suit if required, otherwise play first card
        let card = hand[0]
        if (leadSuit) {
          const suitMatch = hand.find((c) => c.suit === leadSuit)
          if (suitMatch) card = suitMatch
        } else {
          leadSuit = card.suit
        }

        const result = await playCard(pages[currentPlayerId], gameId, card.suit, card.value)

        if (result.status === 'game_complete') return

        if (result.status === 'round_complete') {
          roundEnded = true
          break
        }

        if (result.status === 'trick_complete' && result.winnerId) {
          leaderId = result.winnerId
        }
      }
    }
  }
}
