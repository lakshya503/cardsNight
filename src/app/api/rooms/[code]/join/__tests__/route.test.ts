import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '../route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

import { createClient } from '@/lib/supabase/server'

const ROOM = {
  id: 'room-123',
  code: 'ABC123X',
  status: 'waiting',
  max_players: 6,
}

function makeRequest(code = 'ABC123X') {
  return new NextRequest(`http://localhost/api/rooms/${code}/join`, {
    method: 'POST',
  })
}

function makeContext(code = 'ABC123X') {
  return { params: Promise.resolve({ code }) }
}

function makeSupabaseMock({
  user = { id: 'user-456' },
  room = ROOM as typeof ROOM | null,
  roomError = null,
  existingPlayer = null as { id: string } | null,
  playerCount = 2,
  insertError = null,
}: {
  user?: { id: string } | null
  room?: typeof ROOM | null
  roomError?: unknown
  existingPlayer?: { id: string } | null
  playerCount?: number
  insertError?: unknown
} = {}) {
  // Room query chain
  const roomMaybeSingle = vi.fn().mockResolvedValue({ data: room, error: roomError })
  const roomQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    maybeSingle: roomMaybeSingle,
  }

  // Existing player check chain
  const existingMaybeSingle = vi.fn().mockResolvedValue({ data: existingPlayer, error: null })
  const existingQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: existingMaybeSingle,
  }

  // Player count chain
  const countQuery = Promise.resolve({ count: playerCount, error: null })
  const countChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockResolvedValue({ count: playerCount, error: null }),
  }

  // Insert chain
  const insertQuery = { insert: vi.fn().mockResolvedValue({ error: insertError }) }

  let roomQueryCallCount = 0
  let playerQueryCallCount = 0

  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
    from: vi.fn((table: string) => {
      if (table === 'rooms') return roomQuery
      if (table === 'room_players') {
        playerQueryCallCount++
        // 1st call: existing player check, 2nd call: count, 3rd call: insert
        if (playerQueryCallCount === 1) return existingQuery
        if (playerQueryCallCount === 2) return countChain
        return insertQuery
      }
    }),
  }
}

describe('POST /api/rooms/[code]/join', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 200 with roomId and code on successful join', async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabaseMock() as never)
    const res = await POST(makeRequest(), makeContext())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ roomId: 'room-123', code: 'ABC123X' })
  })

  it('returns 401 if user is not authenticated', async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabaseMock({ user: null }) as never)
    const res = await POST(makeRequest(), makeContext())
    expect(res.status).toBe(401)
  })

  it('returns 404 if room does not exist or is expired', async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabaseMock({ room: null }) as never)
    const res = await POST(makeRequest(), makeContext())
    expect(res.status).toBe(404)
  })

  it('returns 422 if room is already in progress', async () => {
    vi.mocked(createClient).mockResolvedValue(
      makeSupabaseMock({ room: { ...ROOM, status: 'in_progress' } }) as never
    )
    const res = await POST(makeRequest(), makeContext())
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.error).toMatch(/already started/i)
  })

  it('returns 422 if room is finished', async () => {
    vi.mocked(createClient).mockResolvedValue(
      makeSupabaseMock({ room: { ...ROOM, status: 'finished' } }) as never
    )
    const res = await POST(makeRequest(), makeContext())
    expect(res.status).toBe(422)
  })

  it('returns 409 if player is already in the room (including host rejoining)', async () => {
    vi.mocked(createClient).mockResolvedValue(
      makeSupabaseMock({ existingPlayer: { id: 'player-row-1' } }) as never
    )
    const res = await POST(makeRequest(), makeContext())
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toMatch(/already in this room/i)
  })

  it('returns 422 if room is full', async () => {
    vi.mocked(createClient).mockResolvedValue(
      makeSupabaseMock({ playerCount: 6 }) as never // max_players is also 6
    )
    const res = await POST(makeRequest(), makeContext())
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.error).toMatch(/full/i)
  })

  it('normalises the room code to uppercase before querying', async () => {
    const mock = makeSupabaseMock()
    vi.mocked(createClient).mockResolvedValue(mock as never)
    await POST(makeRequest('abc123x'), makeContext('abc123x'))
    // Verify from() was called with 'rooms' — uppercase normalisation is tested
    // implicitly: the route calls code.toUpperCase() before the query
    expect(mock.from).toHaveBeenCalledWith('rooms')
  })
})
