import { test, expect } from '@playwright/test'
import { createTestUser, deleteTestUser, signIn, type TestUser } from './helpers/auth'
import { createRoom, joinRoom, startGame, placeBid, playCard, playFullGame, getCurrentRound, getHand } from './helpers/game'
import { createClient } from '@supabase/supabase-js'

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

async function getSeatOrder(gameId: string): Promise<{ userId: string; seatOrder: number }[]> {
  const admin = adminClient()
  const { data: game } = await admin
    .from('games')
    .select('room_id')
    .eq('id', gameId)
    .maybeSingle()
  if (!game) return []
  const { data: players } = await admin
    .from('room_players')
    .select('user_id, seat_order')
    .eq('room_id', game.room_id)
    .eq('status', 'active')
    .order('seat_order', { ascending: true })
  return (players ?? []).map((p: { user_id: string; seat_order: number }) => ({
    userId: p.user_id,
    seatOrder: p.seat_order,
  }))
}

// ---------------------------------------------------------------------------

let host: TestUser
let guest: TestUser

test.beforeAll(async () => {
  host = await createTestUser('full-host')
  guest = await createTestUser('full-guest')
})

test.afterAll(async () => {
  await deleteTestUser(host.userId)
  await deleteTestUser(guest.userId)
})

// ---------------------------------------------------------------------------

test.describe('Full game lifecycle', () => {
  test('round 1 completes: round_scores inserted and round 2 starts in bidding', async ({ browser }) => {
    test.setTimeout(60_000)
    const hostCtx = await browser.newContext()
    const guestCtx = await browser.newContext()
    const hostPage = await hostCtx.newPage()
    const guestPage = await guestCtx.newPage()

    try {
      await signIn(hostPage, host.email, host.password)
      await signIn(guestPage, guest.email, guest.password)

      const code = await createRoom(hostPage)
      await joinRoom(guestPage, code)
      const gameId = await startGame(hostPage, code)

      const seatOrder = await getSeatOrder(gameId)
      const playerIds = seatOrder.map((p) => p.userId)
      const pages: Record<string, typeof hostPage> = {
        [host.userId]: hostPage,
        [guest.userId]: guestPage,
      }

      // Complete bidding for round 1
      const round1 = await getCurrentRound(gameId)
      let bidderId = round1!.current_player_id!
      for (let i = 0; i < playerIds.length; i++) {
        await placeBid(pages[bidderId], gameId, 0)
        const idx = playerIds.indexOf(bidderId)
        bidderId = playerIds[(idx + 1) % playerIds.length]
      }

      // Play all 10 tricks of round 1
      let leaderId = (await getCurrentRound(gameId))!.current_player_id!

      for (let t = 0; t < 10; t++) {
        let leadSuit: string | null = null
        for (let c = 0; c < playerIds.length; c++) {
          const leaderIdx = playerIds.indexOf(leaderId)
          const currentId = playerIds[(leaderIdx + c) % playerIds.length]
          const hand = await getHand(pages[currentId], gameId)
          let card = hand[0]
          if (leadSuit) {
            const match = hand.find((h) => h.suit === leadSuit)
            if (match) card = match
          } else {
            leadSuit = card.suit
          }
          const result = await playCard(pages[currentId], gameId, card.suit, card.value)
          if (result.status === 'trick_complete' && result.winnerId) leaderId = result.winnerId
          if (result.status === 'round_complete') break
        }
        const afterTrick = await getCurrentRound(gameId)
        if (!afterTrick || afterTrick.status !== 'playing') break
      }

      // Round 1 should be complete; round 2 should exist in bidding status
      const admin = adminClient()
      const { data: round2 } = await admin
        .from('rounds')
        .select('round_number, hand_size, status')
        .eq('game_id', gameId)
        .eq('round_number', 2)
        .maybeSingle()

      expect(round2).not.toBeNull()
      expect(round2!.status).toBe('bidding')
      expect(round2!.hand_size).toBe(9) // started at 10, decrements each round

      // round_scores for round 1 should exist
      const { data: r1 } = await admin
        .from('rounds')
        .select('id')
        .eq('game_id', gameId)
        .eq('round_number', 1)
        .maybeSingle()

      const { data: scores } = await admin
        .from('round_scores')
        .select('player_id, bid, tricks_won, score')
        .eq('round_id', r1!.id)

      expect(scores).toHaveLength(2)
      // Both players bid 0; sum of tricks_won = hand_size = 10
      const totalTricks = scores!.reduce((s: number, rs: { tricks_won: number }) => s + rs.tricks_won, 0)
      expect(totalTricks).toBe(10)
    } finally {
      await hostCtx.close()
      await guestCtx.close()
    }
  })

  test('full game completes: game_results inserted and results page renders', async ({ browser }) => {
    test.setTimeout(180_000) // 3 min — full 10-round game

    const hostCtx = await browser.newContext()
    const guestCtx = await browser.newContext()
    const hostPage = await hostCtx.newPage()
    const guestPage = await guestCtx.newPage()

    try {
      await signIn(hostPage, host.email, host.password)
      await signIn(guestPage, guest.email, guest.password)

      const code = await createRoom(hostPage)
      await joinRoom(guestPage, code)
      const gameId = await startGame(hostPage, code)

      const seatOrder = await getSeatOrder(gameId)
      const playerIds = seatOrder.map((p) => p.userId)
      const pages: Record<string, typeof hostPage> = {
        [host.userId]: hostPage,
        [guest.userId]: guestPage,
      }

      // Play through all 10 rounds
      await playFullGame(pages, gameId, playerIds)

      // Verify game is finished
      const admin = adminClient()
      const { data: game } = await admin
        .from('games')
        .select('status')
        .eq('id', gameId)
        .maybeSingle()

      expect(game!.status).toBe('finished')

      // Verify game_results exist for both players
      const { data: results } = await admin
        .from('game_results')
        .select('player_id, placement, total_score')
        .eq('game_id', gameId)
        .order('placement', { ascending: true })

      expect(results).toHaveLength(2)
      expect(results!.every((r: { total_score: number }) => r.total_score >= 0)).toBe(true)

      // Navigate to results page and verify it renders
      await hostPage.goto(`/game/${gameId}/results`)
      await expect(hostPage.locator('[data-testid="results-panel"]')).toBeVisible({ timeout: 10_000 })
    } finally {
      await hostCtx.close()
      await guestCtx.close()
    }
  })
})
