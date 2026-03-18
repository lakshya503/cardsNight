import { test, expect } from '@playwright/test'
import { createTestUser, deleteTestUser, signIn, type TestUser } from './helpers/auth'
import { createRoom, joinRoom, startGame, placeBid, playCard, getCurrentRound, getHandDirect, cleanupRoom } from './helpers/game'

// ---------------------------------------------------------------------------

let host: TestUser
let guest: TestUser
const createdRoomCodes: string[] = []

test.beforeAll(async () => {
  host = await createTestUser('play-host')
  guest = await createTestUser('play-guest')
})

test.afterAll(async () => {
  for (const code of createdRoomCodes) {
    await cleanupRoom(code)
  }
  await deleteTestUser(host.userId)
  await deleteTestUser(guest.userId)
})

// ---------------------------------------------------------------------------

test.describe('Card play phase', () => {
  test('game page shows trick panel after bidding completes', async ({ browser }) => {
    const hostCtx = await browser.newContext()
    const guestCtx = await browser.newContext()
    const hostPage = await hostCtx.newPage()
    const guestPage = await guestCtx.newPage()

    try {
      await signIn(hostPage, host.email, host.password)
      await signIn(guestPage, guest.email, guest.password)

      const code = await createRoom(hostPage)
      createdRoomCodes.push(code)
      await joinRoom(guestPage, code)
      const gameId = await startGame(hostPage, code)

      // Determine bidding order
      const round = await getCurrentRound(gameId)
      expect(round).not.toBeNull()

      const firstBidderId = round!.current_player_id!
      const firstPage = firstBidderId === host.userId ? hostPage : guestPage
      const secondPage = firstBidderId === host.userId ? guestPage : hostPage

      // Both players bid 0 (safe — forbidden is hand_size, not 0)
      await placeBid(firstPage, gameId, 0)
      await placeBid(secondPage, gameId, 0)

      // Navigate to game page; trick panel should appear
      await hostPage.goto(`/game/${gameId}`)
      await expect(hostPage.locator('[data-testid="trick-panel"]')).toBeVisible({ timeout: 10_000 })
    } finally {
      await hostCtx.close()
      await guestCtx.close()
    }
  })

  test('playing a card advances the turn to the other player', async ({ browser }) => {
    const hostCtx = await browser.newContext()
    const guestCtx = await browser.newContext()
    const hostPage = await hostCtx.newPage()
    const guestPage = await guestCtx.newPage()

    try {
      await signIn(hostPage, host.email, host.password)
      await signIn(guestPage, guest.email, guest.password)

      const code = await createRoom(hostPage)
      createdRoomCodes.push(code)
      await joinRoom(guestPage, code)
      const gameId = await startGame(hostPage, code)

      const round = await getCurrentRound(gameId)
      const firstBidderId = round!.current_player_id!
      const firstBidPage = firstBidderId === host.userId ? hostPage : guestPage
      const secondBidPage = firstBidderId === host.userId ? guestPage : hostPage

      await placeBid(firstBidPage, gameId, 0)
      await placeBid(secondBidPage, gameId, 0)

      // Get updated round to find who leads the first trick
      const playingRound = await getCurrentRound(gameId)
      expect(playingRound!.status).toBe('playing')

      const leaderId = playingRound!.current_player_id!
      const leaderPage = leaderId === host.userId ? hostPage : guestPage

      // Get leader's hand and play the first card
      const leaderHand = await getHandDirect(leaderId, playingRound!.id)
      expect(leaderHand.length).toBeGreaterThan(0)

      const firstCard = leaderHand[0]
      const result = await playCard(leaderPage, gameId, firstCard.suit, firstCard.value)
      expect(result.status).toBe('trick_in_progress')

      // Turn should have advanced
      const afterPlay = await getCurrentRound(gameId)
      expect(afterPlay!.current_player_id).not.toBe(leaderId)
    } finally {
      await hostCtx.close()
      await guestCtx.close()
    }
  })

  test('cannot play a card out of turn', async ({ browser }) => {
    const hostCtx = await browser.newContext()
    const guestCtx = await browser.newContext()
    const hostPage = await hostCtx.newPage()
    const guestPage = await guestCtx.newPage()

    try {
      await signIn(hostPage, host.email, host.password)
      await signIn(guestPage, guest.email, guest.password)

      const code = await createRoom(hostPage)
      createdRoomCodes.push(code)
      await joinRoom(guestPage, code)
      const gameId = await startGame(hostPage, code)

      const round = await getCurrentRound(gameId)
      const firstBidderId = round!.current_player_id!
      const firstBidPage = firstBidderId === host.userId ? hostPage : guestPage
      const secondBidPage = firstBidderId === host.userId ? guestPage : hostPage

      await placeBid(firstBidPage, gameId, 0)
      await placeBid(secondBidPage, gameId, 0)

      const playingRound = await getCurrentRound(gameId)
      const leaderId = playingRound!.current_player_id!
      const nonLeaderPage = leaderId === host.userId ? guestPage : hostPage
      const nonLeaderId = leaderId === host.userId ? guest.userId : host.userId

      // Non-leader tries to play
      const hand = await getHandDirect(nonLeaderId, playingRound!.id)
      const res = await nonLeaderPage.request.post(`/api/games/${gameId}/play`, {
        data: { suit: hand[0].suit, value: hand[0].value },
      })
      expect(res.status()).toBe(422)
      expect((await res.json()).error).toMatch(/Not your turn/)
    } finally {
      await hostCtx.close()
      await guestCtx.close()
    }
  })
})
