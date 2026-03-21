import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '../route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

function makeRequest(code = 'ABC1234') {
  return new NextRequest(`http://localhost/api/rooms/${code}/start`, { method: 'POST' })
}

// Server client: auth + room lookup
function makeServerMock({
  user = { id: 'host-id' } as { id: string } | null,
  room = { id: 'room-id', host_id: 'host-id', status: 'waiting' } as {
    id: string; host_id: string; status: string
  } | null,
} = {}) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: room })
  const neq = vi.fn().mockReturnValue({ maybeSingle })
  const eq = vi.fn().mockReturnValue({ neq })
  const select = vi.fn().mockReturnValue({ eq })
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
    from: vi.fn().mockReturnValue({ select }),
  }
}

// Admin client: room_players, games, rounds, hands, rooms
function makeAdminMock({
  activePlayers = [
    { id: 'rp-1', user_id: 'user-1' },
    { id: 'rp-2', user_id: 'user-2' },
    { id: 'rp-3', user_id: 'user-3' },
    { id: 'rp-4', user_id: 'user-4' },
  ] as Array<{ id: string; user_id: string }>,
  gameData = { id: 'game-id' } as { id: string } | null,
  gameError = null as unknown,
  roundData = { id: 'round-id' } as { id: string } | null,
  roundError = null as unknown,
  handsError = null as unknown,
} = {}) {
  // room_players SELECT: .select().eq().eq() → resolves
  const rpSelectEq2 = vi.fn().mockResolvedValue({ data: activePlayers })
  const rpSelectEq1 = vi.fn().mockReturnValue({ eq: rpSelectEq2 })
  const rpSelect = vi.fn().mockReturnValue({ eq: rpSelectEq1 })

  // room_players UPDATE: .update().eq() → resolves
  const rpUpdateEq = vi.fn().mockResolvedValue({})
  const rpUpdate = vi.fn().mockReturnValue({ eq: rpUpdateEq })

  // games INSERT: .insert().select().single() → resolves
  const gamesSingle = vi.fn().mockResolvedValue({ data: gameData, error: gameError })
  const gamesInsert = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: gamesSingle }) })

  // rounds INSERT: .insert().select().single() → resolves
  const roundsSingle = vi.fn().mockResolvedValue({ data: roundData, error: roundError })
  const roundsInsert = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: roundsSingle }) })

  // hands INSERT: .insert() → resolves
  const handsInsert = vi.fn().mockResolvedValue({ error: handsError })

  // rooms UPDATE: .update().eq() → resolves
  const roomsUpdateEq = vi.fn().mockResolvedValue({})
  const roomsUpdate = vi.fn().mockReturnValue({ eq: roomsUpdateEq })

  const fromMap: Record<string, unknown> = {
    room_players: { select: rpSelect, update: rpUpdate },
    games: { insert: gamesInsert },
    rounds: { insert: roundsInsert },
    hands: { insert: handsInsert },
    rooms: { update: roomsUpdate },
  }

  return { from: vi.fn((table: string) => fromMap[table]) }
}

describe('POST /api/rooms/[code]/start', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 if not authenticated', async () => {
    vi.mocked(createClient).mockResolvedValue(makeServerMock({ user: null }) as never)
    vi.mocked(createAdminClient).mockReturnValue(makeAdminMock() as never)
    const res = await POST(makeRequest(), { params: Promise.resolve({ code: 'ABC1234' }) })
    expect(res.status).toBe(401)
  })

  it('returns 404 if room not found', async () => {
    vi.mocked(createClient).mockResolvedValue(makeServerMock({ room: null }) as never)
    vi.mocked(createAdminClient).mockReturnValue(makeAdminMock() as never)
    const res = await POST(makeRequest(), { params: Promise.resolve({ code: 'ABC1234' }) })
    expect(res.status).toBe(404)
  })

  it('returns 403 if caller is not the host', async () => {
    vi.mocked(createClient).mockResolvedValue(
      makeServerMock({
        user: { id: 'other-user' },
        room: { id: 'room-id', host_id: 'host-id', status: 'waiting' },
      }) as never
    )
    vi.mocked(createAdminClient).mockReturnValue(makeAdminMock() as never)
    const res = await POST(makeRequest(), { params: Promise.resolve({ code: 'ABC1234' }) })
    expect(res.status).toBe(403)
  })

  it('returns 422 if room is not in waiting status', async () => {
    vi.mocked(createClient).mockResolvedValue(
      makeServerMock({ room: { id: 'room-id', host_id: 'host-id', status: 'in_progress' } }) as never
    )
    vi.mocked(createAdminClient).mockReturnValue(makeAdminMock() as never)
    const res = await POST(makeRequest(), { params: Promise.resolve({ code: 'ABC1234' }) })
    expect(res.status).toBe(422)
  })

  it('returns 422 if fewer than MIN_PLAYERS are active', async () => {
    vi.mocked(createClient).mockResolvedValue(makeServerMock() as never)
    vi.mocked(createAdminClient).mockReturnValue(
      makeAdminMock({ activePlayers: [{ id: 'rp-1', user_id: 'user-1' }] }) as never
    )
    const res = await POST(makeRequest(), { params: Promise.resolve({ code: 'ABC1234' }) })
    expect(res.status).toBe(422)
  })

  it('returns 200 with gameId on success', async () => {
    vi.mocked(createClient).mockResolvedValue(makeServerMock() as never)
    const adminMock = makeAdminMock()
    vi.mocked(createAdminClient).mockReturnValue(adminMock as never)
    const res = await POST(makeRequest(), { params: Promise.resolve({ code: 'ABC1234' }) })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ gameId: 'game-id' })

    // Verify rounds insert includes turn_started_at as ISO 8601 string
    const roundsTable = adminMock.from('rounds')
    const roundsInsertMock = roundsTable.insert as ReturnType<typeof vi.fn>
    const roundsInsertArg = roundsInsertMock.mock.calls[0]?.[0]
    expect(roundsInsertArg.turn_started_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })

  it('returns 500 if game insert fails', async () => {
    vi.mocked(createClient).mockResolvedValue(makeServerMock() as never)
    vi.mocked(createAdminClient).mockReturnValue(
      makeAdminMock({ gameData: null, gameError: { message: 'db error' } }) as never
    )
    const res = await POST(makeRequest(), { params: Promise.resolve({ code: 'ABC1234' }) })
    expect(res.status).toBe(500)
  })

  it('returns 500 if round insert fails', async () => {
    vi.mocked(createClient).mockResolvedValue(makeServerMock() as never)
    vi.mocked(createAdminClient).mockReturnValue(
      makeAdminMock({ roundData: null, roundError: { message: 'db error' } }) as never
    )
    const res = await POST(makeRequest(), { params: Promise.resolve({ code: 'ABC1234' }) })
    expect(res.status).toBe(500)
  })

  it('returns 500 if hands insert fails', async () => {
    vi.mocked(createClient).mockResolvedValue(makeServerMock() as never)
    vi.mocked(createAdminClient).mockReturnValue(
      makeAdminMock({ handsError: { message: 'db error' } }) as never
    )
    const res = await POST(makeRequest(), { params: Promise.resolve({ code: 'ABC1234' }) })
    expect(res.status).toBe(500)
  })
})
