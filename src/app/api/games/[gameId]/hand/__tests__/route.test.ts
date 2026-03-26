import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from '../route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/game/server', () => ({ getPlayerHand: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPlayerHand } from '@/lib/game/server'

function makeRequest(gameId = 'game-1') {
  return new NextRequest(`http://localhost/api/games/${gameId}/hand`, { method: 'GET' })
}

function makeParams(gameId = 'game-1') {
  return { params: Promise.resolve({ gameId }) }
}

function makeAuthMock(user: { id: string } | null = { id: 'user-1' }) {
  return { auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) } }
}

function makeAdminMock({
  game = { id: 'game-1', room_id: 'room-1', status: 'in_progress' } as
    { id: string; room_id: string; status: string } | null,
  roomPlayer = { id: 'rp-1' } as { id: string } | null,
  round = { id: 'round-1' } as { id: string } | null,
} = {}) {
  const gameMaybeSingle = vi.fn().mockResolvedValue({ data: game })
  const gameChain = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: gameMaybeSingle }

  const rpMaybeSingle = vi.fn().mockResolvedValue({ data: roomPlayer })
  const rpChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    maybeSingle: rpMaybeSingle,
  }

  const roundMaybeSingle = vi.fn().mockResolvedValue({ data: round })
  const roundChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: roundMaybeSingle,
  }

  let callCount = 0
  return {
    from: vi.fn((table: string) => {
      if (table === 'games') return gameChain
      if (table === 'room_players') return rpChain
      if (table === 'rounds') return roundChain
      callCount++
    }),
  }
}

describe('GET /api/games/[gameId]/hand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getPlayerHand).mockResolvedValue([])
  })

  it('returns 401 if user is not authenticated', async () => {
    vi.mocked(createClient).mockResolvedValue(makeAuthMock(null) as never)
    vi.mocked(createAdminClient).mockReturnValue(makeAdminMock() as never)
    const res = await GET(makeRequest(), makeParams())
    expect(res.status).toBe(401)
  })

  it('returns 404 if game not found', async () => {
    vi.mocked(createClient).mockResolvedValue(makeAuthMock() as never)
    vi.mocked(createAdminClient).mockReturnValue(makeAdminMock({ game: null }) as never)
    const res = await GET(makeRequest(), makeParams())
    expect(res.status).toBe(404)
  })

  it('returns 404 if game is not in_progress', async () => {
    vi.mocked(createClient).mockResolvedValue(makeAuthMock() as never)
    vi.mocked(createAdminClient).mockReturnValue(
      makeAdminMock({ game: { id: 'game-1', room_id: 'room-1', status: 'finished' } }) as never
    )
    const res = await GET(makeRequest(), makeParams())
    expect(res.status).toBe(404)
  })

  it('returns 403 if player is not in the game', async () => {
    vi.mocked(createClient).mockResolvedValue(makeAuthMock() as never)
    vi.mocked(createAdminClient).mockReturnValue(makeAdminMock({ roomPlayer: null }) as never)
    const res = await GET(makeRequest(), makeParams())
    expect(res.status).toBe(403)
  })

  it('returns empty cards if no active round', async () => {
    vi.mocked(createClient).mockResolvedValue(makeAuthMock() as never)
    vi.mocked(createAdminClient).mockReturnValue(makeAdminMock({ round: null }) as never)
    const res = await GET(makeRequest(), makeParams())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ cards: [] })
  })

  it('returns cards from getPlayerHand on success', async () => {
    const cards = [{ suit: 'hearts', value: 'A' }, { suit: 'spades', value: 'K' }]
    vi.mocked(getPlayerHand).mockResolvedValue(cards as never)
    vi.mocked(createClient).mockResolvedValue(makeAuthMock() as never)
    vi.mocked(createAdminClient).mockReturnValue(makeAdminMock() as never)
    const res = await GET(makeRequest(), makeParams())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ cards })
  })
})
