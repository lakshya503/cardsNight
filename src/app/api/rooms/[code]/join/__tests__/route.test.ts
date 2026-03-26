import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '../route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const ROOM = {
  id: 'room-123',
  code: 'ABC123X',
  status: 'waiting',
  max_players: 6,
  current_game_id: null as string | null,
}

function makeRequest(code = 'ABC123X') {
  return new NextRequest(`http://localhost/api/rooms/${code}/join`, {
    method: 'POST',
  })
}

function makeContext(code = 'ABC123X') {
  return { params: Promise.resolve({ code }) }
}

/**
 * The SSR client is used only for auth.getUser() in this route.
 */
function makeAuthMock(user: { id: string } | null = { id: 'user-456' }) {
  return { auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) } }
}

/**
 * The admin client handles all DB queries: rooms, room_players (×3), insert.
 */
function makeAdminMock({
  room = ROOM as typeof ROOM | null,
  roomError = null,
  existingPlayer = null as { id: string; status?: string } | null,
  playerCount = 2,
  insertError = null,
}: {
  room?: typeof ROOM | null
  roomError?: unknown
  existingPlayer?: { id: string; status?: string } | null
  playerCount?: number
  insertError?: unknown
} = {}) {
  const roomMaybeSingle = vi.fn().mockResolvedValue({ data: room, error: roomError })
  const roomQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    maybeSingle: roomMaybeSingle,
  }

  const existingMaybeSingle = vi.fn().mockResolvedValue({ data: existingPlayer, error: null })
  const existingQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: existingMaybeSingle,
  }

  const countChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockResolvedValue({ count: playerCount, error: null }),
  }

  const insertQuery = { insert: vi.fn().mockResolvedValue({ error: insertError }) }

  let playerQueryCallCount = 0

  const mock = {
    from: vi.fn((table: string) => {
      if (table === 'rooms') return roomQuery
      if (table === 'room_players') {
        playerQueryCallCount++
        if (playerQueryCallCount === 1) return existingQuery
        if (playerQueryCallCount === 2) return countChain
        return insertQuery
      }
    }),
  }

  return mock
}

describe('POST /api/rooms/[code]/join', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 200 with roomId and code on successful join', async () => {
    vi.mocked(createClient).mockResolvedValue(makeAuthMock() as never)
    vi.mocked(createAdminClient).mockReturnValue(makeAdminMock() as never)
    const res = await POST(makeRequest(), makeContext())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ roomId: 'room-123', code: 'ABC123X' })
  })

  it('returns 401 if user is not authenticated', async () => {
    vi.mocked(createClient).mockResolvedValue(makeAuthMock(null) as never)
    vi.mocked(createAdminClient).mockReturnValue(makeAdminMock() as never)
    const res = await POST(makeRequest(), makeContext())
    expect(res.status).toBe(401)
  })

  it('returns 404 if room does not exist or is expired', async () => {
    vi.mocked(createClient).mockResolvedValue(makeAuthMock() as never)
    vi.mocked(createAdminClient).mockReturnValue(makeAdminMock({ room: null }) as never)
    const res = await POST(makeRequest(), makeContext())
    expect(res.status).toBe(404)
  })

  it('returns 422 if room is already in progress', async () => {
    vi.mocked(createClient).mockResolvedValue(makeAuthMock() as never)
    vi.mocked(createAdminClient).mockReturnValue(
      makeAdminMock({ room: { ...ROOM, status: 'in_progress' } }) as never
    )
    const res = await POST(makeRequest(), makeContext())
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.error).toMatch(/already started/i)
  })

  it('returns 422 if room is finished', async () => {
    vi.mocked(createClient).mockResolvedValue(makeAuthMock() as never)
    vi.mocked(createAdminClient).mockReturnValue(
      makeAdminMock({ room: { ...ROOM, status: 'finished' } }) as never
    )
    const res = await POST(makeRequest(), makeContext())
    expect(res.status).toBe(422)
  })

  it('returns 409 if player is already in the room (including host rejoining)', async () => {
    vi.mocked(createClient).mockResolvedValue(makeAuthMock() as never)
    vi.mocked(createAdminClient).mockReturnValue(
      makeAdminMock({ existingPlayer: { id: 'player-row-1' } }) as never
    )
    const res = await POST(makeRequest(), makeContext())
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toMatch(/already in this room/i)
  })

  it('returns 422 if room is full', async () => {
    vi.mocked(createClient).mockResolvedValue(makeAuthMock() as never)
    vi.mocked(createAdminClient).mockReturnValue(
      makeAdminMock({ playerCount: 6 }) as never // max_players is also 6
    )
    const res = await POST(makeRequest(), makeContext())
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.error).toMatch(/full/i)
  })

  it('returns 200 with reconnecting:true for an active player mid-game', async () => {
    const activeRoom = { ...ROOM, status: 'active', current_game_id: 'game-456' }
    vi.mocked(createClient).mockResolvedValue(makeAuthMock() as never)
    vi.mocked(createAdminClient).mockReturnValue(
      makeAdminMock({ room: activeRoom, existingPlayer: { id: 'player-row-1', status: 'active' } }) as never
    )
    const res = await POST(makeRequest(), makeContext())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ reconnecting: true, gameId: 'game-456', code: 'ABC123X' })
  })

  it('returns 200 with reconnecting:true for a disconnected player mid-game', async () => {
    const activeRoom = { ...ROOM, status: 'active', current_game_id: 'game-456' }
    vi.mocked(createClient).mockResolvedValue(makeAuthMock() as never)
    vi.mocked(createAdminClient).mockReturnValue(
      makeAdminMock({ room: activeRoom, existingPlayer: { id: 'player-row-1', status: 'disconnected' } }) as never
    )
    const res = await POST(makeRequest(), makeContext())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ reconnecting: true, gameId: 'game-456', code: 'ABC123X' })
  })

  it('returns 409 with a clear message for a dropped player even mid-game', async () => {
    const activeRoom = { ...ROOM, status: 'active', current_game_id: 'game-456' }
    vi.mocked(createClient).mockResolvedValue(makeAuthMock() as never)
    vi.mocked(createAdminClient).mockReturnValue(
      makeAdminMock({ room: activeRoom, existingPlayer: { id: 'player-row-1', status: 'dropped' } }) as never
    )
    const res = await POST(makeRequest(), makeContext())
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toMatch(/dropped/i)
  })

  it('normalises the room code to uppercase before querying', async () => {
    const adminMock = makeAdminMock()
    vi.mocked(createClient).mockResolvedValue(makeAuthMock() as never)
    vi.mocked(createAdminClient).mockReturnValue(adminMock as never)
    await POST(makeRequest('abc123x'), makeContext('abc123x'))
    expect(adminMock.from).toHaveBeenCalledWith('rooms')
  })
})
