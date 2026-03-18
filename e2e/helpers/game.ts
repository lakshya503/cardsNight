import type { Page } from '@playwright/test'

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
