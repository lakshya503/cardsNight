import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '../route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

function makeRequest(gameId = 'game-id', body: Record<string, unknown> = { disconnectedUserId: 'player-2' }) {
  return new NextRequest(`http://localhost/api/games/${gameId}/disconnect`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeParams(gameId = 'game-id') {
  return { params: Promise.resolve({ gameId }) }
}

function makeServerMock(user: { id: string } | null = { id: 'player-1' }) {
  return { auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) } }
}

// ─── Default fixtures ─────────────────────────────────────────────────────────
const DEFAULT_GAME = { id: 'game-id', room_id: 'room-id', status: 'in_progress' }
const DEFAULT_ROOM_PLAYER = { id: 'rp-1' }

// ─── Admin mock factory ───────────────────────────────────────────────────────
function makeAdminMock({
  game = DEFAULT_GAME as typeof DEFAULT_GAME | null,
  callerIsPlayer = true,
  // What the conditional UPDATE on room_players returns (0 rows = already disconnected)
  disconnectRows = [{ id: 'rp-2' }] as Array<{ id: string }>,
  updateError = null as unknown,
} = {}) {
  // games SELECT
  const gameMaybeSingle = vi.fn().mockResolvedValue({ data: game })
  const gameEq = vi.fn().mockReturnValue({ maybeSingle: gameMaybeSingle })
  const gameSelect = vi.fn().mockReturnValue({ eq: gameEq })

  // room_players SELECT (caller auth check): .select().eq().eq().eq().maybeSingle()
  const callerMaybeSingle = vi.fn().mockResolvedValue({
    data: callerIsPlayer ? DEFAULT_ROOM_PLAYER : null,
  })
  const callerEq3 = vi.fn().mockReturnValue({ maybeSingle: callerMaybeSingle })
  const callerEq2 = vi.fn().mockReturnValue({ eq: callerEq3 })
  const callerEq1 = vi.fn().mockReturnValue({ eq: callerEq2 })
  const callerSelect = vi.fn().mockReturnValue({ eq: callerEq1 })

  // room_players conditional UPDATE: .update().eq().eq().eq().select('id')
  // Three .eq() calls: room_id, user_id, status='active'
  const updateSelectId = vi.fn().mockResolvedValue({ data: disconnectRows, error: updateError })
  const updateEq3 = vi.fn().mockReturnValue({ select: updateSelectId })
  const updateEq2 = vi.fn().mockReturnValue({ eq: updateEq3 })
  const updateEq1 = vi.fn().mockReturnValue({ eq: updateEq2 })
  const rpUpdate = vi.fn().mockReturnValue({ eq: updateEq1 })

  let rpCallCount = 0
  const fromMock = vi.fn().mockImplementation((table: string) => {
    if (table === 'games') return { select: gameSelect }
    if (table === 'room_players') {
      const idx = rpCallCount++
      if (idx === 0) return { select: callerSelect }
      return { update: rpUpdate }
    }
    throw new Error(`Unexpected table: ${table}`)
  })

  return { from: fromMock, rpUpdate }
}

beforeEach(() => {
  vi.resetAllMocks()
})

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('POST /api/games/[gameId]/disconnect', () => {
  // ── Guard tests ─────────────────────────────────────────────────────────────
  it('returns 401 when unauthenticated', async () => {
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock(null))
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(makeAdminMock())
    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(401)
  })

  it('returns 400 when disconnectedUserId is missing from the body', async () => {
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock())
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(makeAdminMock())
    const res = await POST(makeRequest('game-id', {}), makeParams())
    expect(res.status).toBe(400)
  })

  it('returns 404 when the game is not found or not in progress', async () => {
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock())
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(makeAdminMock({ game: null }))
    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(404)
  })

  it('returns 403 when caller is not an active player in the game', async () => {
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock())
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(
      makeAdminMock({ callerIsPlayer: false })
    )
    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(403)
  })

  it('returns 400 when disconnectedUserId is the caller (cannot self-disconnect)', async () => {
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock({ id: 'player-1' }))
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(makeAdminMock())
    // caller is player-1, trying to report themselves
    const res = await POST(makeRequest('game-id', { disconnectedUserId: 'player-1' }), makeParams())
    expect(res.status).toBe(400)
  })

  // ── Happy path ───────────────────────────────────────────────────────────────
  it('marks the player as disconnected and returns { status: disconnected }', async () => {
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock())
    const admin = makeAdminMock({ disconnectRows: [{ id: 'rp-2' }] })
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(admin)

    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('disconnected')

    // The conditional UPDATE must target: room_id, user_id=disconnectedUserId, status='active'
    const updateArg = (admin.rpUpdate as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>
    expect(updateArg.status).toBe('disconnected')
    expect(updateArg.disconnected_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })

  it('returns { status: already_disconnected } when conditional UPDATE matches 0 rows', async () => {
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock())
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(
      makeAdminMock({ disconnectRows: [] }) // 0 rows → already disconnected
    )

    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('already_disconnected')
  })

  it('returns 500 when the UPDATE fails with a DB error', async () => {
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock())
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(
      makeAdminMock({ updateError: { message: 'DB error' } })
    )

    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(500)
  })
})
