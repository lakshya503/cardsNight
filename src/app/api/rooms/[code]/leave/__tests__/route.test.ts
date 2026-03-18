import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '../route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const ROOM = { id: 'room-1', host_id: 'user-1', status: 'waiting' }

function makeRequest(code = 'ABC123X') {
  return new NextRequest(`http://localhost/api/rooms/${code}/leave`, { method: 'POST' })
}

function makeContext(code = 'ABC123X') {
  return { params: Promise.resolve({ code }) }
}

function makeAuthMock(user: { id: string } | null = { id: 'user-1' }) {
  return { auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) } }
}

function makeAdminMock({
  room = ROOM as typeof ROOM | null,
  player = { id: 'player-row-1' } as { id: string } | null,
  dropError = null as unknown,
  remaining = [] as Array<{ user_id: string }>,
} = {}) {
  const roomMaybeSingle = vi.fn().mockResolvedValue({ data: room })
  const roomQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    maybeSingle: roomMaybeSingle,
  }

  const playerMaybeSingle = vi.fn().mockResolvedValue({ data: player })
  const playerQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: playerMaybeSingle,
  }

  const dropUpdate = vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ error: dropError }),
  })

  const remainingSelect = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnThis(),
    // second eq returns the data
    select: vi.fn().mockReturnThis(),
  })

  // For host transfer / cancel: rooms.update().eq()
  const hostUpdateEq = vi.fn().mockResolvedValue({ error: null })
  const hostUpdate = vi.fn().mockReturnValue({ eq: hostUpdateEq })

  // For fetching remaining players after drop
  const remainingData = vi.fn().mockResolvedValue({ data: remaining })
  const remainingEq2 = vi.fn().mockReturnValue(remainingData)
  const remainingEq1 = vi.fn().mockReturnValue({ eq: remainingEq2 })
  const remainingSelectChain = vi.fn().mockReturnValue({ eq: remainingEq1 })

  let roomPlayerCallCount = 0
  let roomsCallCount = 0

  const mock = {
    from: vi.fn((table: string) => {
      if (table === 'rooms') {
        roomsCallCount++
        if (roomsCallCount === 1) return roomQuery
        // second call: update host or cancel
        return { update: hostUpdate }
      }
      if (table === 'room_players') {
        roomPlayerCallCount++
        if (roomPlayerCallCount === 1) return playerQuery
        if (roomPlayerCallCount === 2) return { update: dropUpdate }
        // third call: fetch remaining players
        return { select: remainingSelectChain }
      }
    }),
  }

  return mock
}

describe('POST /api/rooms/[code]/leave', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 if user is not authenticated', async () => {
    vi.mocked(createClient).mockResolvedValue(makeAuthMock(null) as never)
    vi.mocked(createAdminClient).mockReturnValue(makeAdminMock() as never)
    const res = await POST(makeRequest(), makeContext())
    expect(res.status).toBe(401)
  })

  it('returns 404 if room not found', async () => {
    vi.mocked(createClient).mockResolvedValue(makeAuthMock() as never)
    vi.mocked(createAdminClient).mockReturnValue(makeAdminMock({ room: null }) as never)
    const res = await POST(makeRequest(), makeContext())
    expect(res.status).toBe(404)
  })

  it('returns 422 if room is not in waiting state', async () => {
    vi.mocked(createClient).mockResolvedValue(makeAuthMock() as never)
    vi.mocked(createAdminClient).mockReturnValue(
      makeAdminMock({ room: { ...ROOM, status: 'in_progress' } }) as never
    )
    const res = await POST(makeRequest(), makeContext())
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.error).toMatch(/already in progress/i)
  })

  it('returns 422 if player is not in the room', async () => {
    vi.mocked(createClient).mockResolvedValue(makeAuthMock() as never)
    vi.mocked(createAdminClient).mockReturnValue(makeAdminMock({ player: null }) as never)
    const res = await POST(makeRequest(), makeContext())
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.error).toMatch(/not in this room/i)
  })

  it('returns 500 if drop update fails', async () => {
    vi.mocked(createClient).mockResolvedValue(makeAuthMock() as never)
    vi.mocked(createAdminClient).mockReturnValue(
      makeAdminMock({ dropError: { message: 'DB error' } }) as never
    )
    const res = await POST(makeRequest(), makeContext())
    expect(res.status).toBe(500)
  })

  it('returns 200 on successful leave', async () => {
    // Non-host user leaving
    vi.mocked(createClient).mockResolvedValue(makeAuthMock({ id: 'user-2' }) as never)
    vi.mocked(createAdminClient).mockReturnValue(
      makeAdminMock({ room: { ...ROOM, host_id: 'user-1' } }) as never
    )
    const res = await POST(makeRequest(), makeContext())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
  })
})
