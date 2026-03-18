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
  if (!res.ok()) return []
  const { cards } = await res.json()
  return cards as Array<{ suit: string; value: string }>
}

/**
 * Plays a card via the API. The page must be authenticated as the current player.
 */
export async function playCard(
  page: Page,
  gameId: string,
  suit: string,
  value: string,
): Promise<{ status: string; winnerId?: string }> {
  const res = await page.request.post(`/api/games/${gameId}/play`, { data: { suit, value } })
  if (!res.ok()) {
    throw new Error(`playCard failed (${res.status()}): ${await res.text()}`)
  }
  return res.json()
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

        const hand = await getHand(pages[currentPlayerId], gameId)

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
