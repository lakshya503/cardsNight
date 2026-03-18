import { test, expect, type Page } from '@playwright/test'
import { createTestUser, deleteTestUser, signIn, type TestUser } from './helpers/auth'
import { createRoom, joinRoom, startGame, placeBid, getCurrentRound, cleanupRoom } from './helpers/game'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let host: TestUser
let guest: TestUser
const createdRoomCodes: string[] = []

test.beforeAll(async () => {
  host = await createTestUser('bid-host')
  guest = await createTestUser('bid-guest')
})

test.afterAll(async () => {
  for (const code of createdRoomCodes) {
    await cleanupRoom(code)
  }
  await deleteTestUser(host.userId)
  await deleteTestUser(guest.userId)
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Bidding phase', () => {
  test('game page loads and shows bidding panel after game starts', async ({ browser }) => {
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

      await hostPage.goto(`/game/${gameId}`)
      await expect(hostPage.locator('[data-testid="bidding-panel"]')).toBeVisible({ timeout: 10_000 })
    } finally {
      await hostCtx.close()
      await guestCtx.close()
    }
  })

  test('both players can bid and round transitions to playing', async ({ browser }) => {
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

      // Determine turn order from the round
      const round = await getCurrentRound(gameId)
      expect(round).not.toBeNull()
      expect(round!.status).toBe('bidding')

      // Map userId → page so we can bid in correct order
      const userPageMap: Record<string, Page> = {
        [host.userId]: hostPage,
        [guest.userId]: guestPage,
      }

      const firstBidderId = round!.current_player_id!
      const secondBidderId = firstBidderId === host.userId ? guest.userId : host.userId

      // First player bids 1
      await placeBid(userPageMap[firstBidderId], gameId, 1)

      // Second player can't bid 9 (hand_size=10, existing=1, forbidden=9); bids 0
      await placeBid(userPageMap[secondBidderId], gameId, 0)

      // Round should now be in 'playing' status
      const updatedRound = await getCurrentRound(gameId)
      expect(updatedRound!.status).toBe('playing')
    } finally {
      await hostCtx.close()
      await guestCtx.close()
    }
  })

  test('cannot bid out of turn', async ({ browser }) => {
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

      // The player whose turn it is NOT tries to bid
      const outOfTurnPage = firstBidderId === host.userId ? guestPage : hostPage
      const res = await outOfTurnPage.request.post(`/api/games/${gameId}/bid`, {
        data: { amount: 2 },
      })

      expect(res.status()).toBe(422)
      const body = await res.json()
      expect(body.error).toMatch(/Not your turn/)
    } finally {
      await hostCtx.close()
      await guestCtx.close()
    }
  })
})
