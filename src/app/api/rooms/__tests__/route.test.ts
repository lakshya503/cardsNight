import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '../route'
import { NextRequest } from 'next/server'

// Mock Supabase server client
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

// Mock room code generation
vi.mock('@/lib/game/roomCode', () => ({
  generateUniqueRoomCode: vi.fn().mockResolvedValue('ABC123X'),
}))

import { createClient } from '@/lib/supabase/server'

const validBody = {
  game_type: 'judgement',
  max_players: 6,
  turn_timer_seconds: 30,
}

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/rooms', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

function makeSupabaseMock({
  user = { id: 'user-123' },
  roomInsertError = null,
  roomInsertData = { id: 'room-456' },
  playerInsertError = null,
}: {
  user?: { id: string } | null
  roomInsertError?: unknown
  roomInsertData?: { id: string } | null
  playerInsertError?: unknown
} = {}) {
  const single = vi.fn().mockResolvedValue({ data: roomInsertData, error: roomInsertError })
  const roomInsert = { insert: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single }) }) }
  const playerInsert = { insert: vi.fn().mockResolvedValue({ error: playerInsertError }) }
  const roomDelete = { delete: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({}) }) }

  const fromMap: Record<string, unknown> = {
    rooms: { ...roomInsert, ...roomDelete },
    room_players: playerInsert,
  }

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user } }),
    },
    from: vi.fn((table: string) => fromMap[table]),
  }
}

describe('POST /api/rooms', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 201 with roomId and code on success', async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabaseMock() as never)
    const res = await POST(makeRequest(validBody))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json).toEqual({ roomId: 'room-456', code: 'ABC123X' })
  })

  it('returns 401 if user is not authenticated', async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabaseMock({ user: null }) as never)
    const res = await POST(makeRequest(validBody))
    expect(res.status).toBe(401)
  })

  it('returns 400 for malformed JSON body', async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabaseMock() as never)
    const req = new NextRequest('http://localhost/api/rooms', {
      method: 'POST',
      body: 'not-json',
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 422 for invalid max_players', async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabaseMock() as never)
    const res = await POST(makeRequest({ ...validBody, max_players: 1 }))
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.details[0].field).toBe('max_players')
  })

  it('returns 422 for unknown game_type', async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabaseMock() as never)
    const res = await POST(makeRequest({ ...validBody, game_type: 'poker' }))
    expect(res.status).toBe(422)
  })

  it('returns 422 for invalid turn_timer_seconds', async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabaseMock() as never)
    const res = await POST(makeRequest({ ...validBody, turn_timer_seconds: 5 }))
    expect(res.status).toBe(422)
  })

  it('returns 201 when turn_timer_seconds is omitted', async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabaseMock() as never)
    const { turn_timer_seconds: _, ...bodyWithoutTimer } = validBody
    const res = await POST(makeRequest(bodyWithoutTimer))
    expect(res.status).toBe(201)
  })

  it('returns 500 and cleans up room if player insert fails', async () => {
    vi.mocked(createClient).mockResolvedValue(
      makeSupabaseMock({ playerInsertError: { message: 'db error' } }) as never
    )
    const res = await POST(makeRequest(validBody))
    expect(res.status).toBe(500)
  })
})
