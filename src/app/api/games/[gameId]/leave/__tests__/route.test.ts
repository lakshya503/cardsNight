import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { POST } from '../route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/game/autoResolve', () => ({
  resolveDroppedTurnChain: vi.fn().mockResolvedValue(undefined),
}))

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveDroppedTurnChain } from '@/lib/game/autoResolve'

function makeRequest(gameId = 'game-id') {
  return new NextRequest(`http://localhost/api/games/${gameId}/leave`, {
    method: 'POST',
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

// ─── Admin mock factory ───────────────────────────────────────────────────────
function makeAdminMock({
  game = DEFAULT_GAME as typeof DEFAULT_GAME | null,
  callerIsPlayer = true,
  dropRows = [{ id: 'rp-1' }] as Array<{ id: string }>,
  dropError = null as unknown,
  gameRoundIds = [{ id: 'round-1' }] as Array<{ id: string }>,
  cumScores = [{ score: 30 }, { score: 20 }] as Array<{ score: number }>,
  upsertError = null as unknown,
} = {}) {
  // games SELECT: .select().eq().maybeSingle()
  const gameMaybeSingle = vi.fn().mockResolvedValue({ data: game })
  const gameEq = vi.fn().mockReturnValue({ maybeSingle: gameMaybeSingle })
  const gameSelect = vi.fn().mockReturnValue({ eq: gameEq })

  // room_players SELECT (caller): .select().eq().eq().in().maybeSingle()
  const callerMaybeSingle = vi.fn().mockResolvedValue({ data: callerIsPlayer ? { id: 'rp-1' } : null })
  const callerIn = vi.fn().mockReturnValue({ maybeSingle: callerMaybeSingle })
  const callerEq2 = vi.fn().mockReturnValue({ in: callerIn })
  const callerEq1 = vi.fn().mockReturnValue({ eq: callerEq2 })
  const callerSelect = vi.fn().mockReturnValue({ eq: callerEq1 })

  // room_players UPDATE (conditional drop): .update().eq().eq().in().select('id')
  const dropSelectId = vi.fn().mockResolvedValue({ data: dropRows, error: dropError })
  const dropIn = vi.fn().mockReturnValue({ select: dropSelectId })
  const dropEq2 = vi.fn().mockReturnValue({ in: dropIn })
  const dropEq1 = vi.fn().mockReturnValue({ eq: dropEq2 })
  const rpUpdate = vi.fn().mockReturnValue({ eq: dropEq1 })

  // rounds SELECT: .select('id').eq('game_id', gameId)
  const roundsEq = vi.fn().mockResolvedValue({ data: gameRoundIds })
  const roundsSelect = vi.fn().mockReturnValue({ eq: roundsEq })

  // round_scores SELECT: .select('score').in('round_id', [...]).eq('player_id', id)
  const scoresEqPlayerId = vi.fn().mockResolvedValue({ data: cumScores })
  const scoresIn = vi.fn().mockReturnValue({ eq: scoresEqPlayerId })
  const scoresSelect = vi.fn().mockReturnValue({ in: scoresIn })

  // game_results UPSERT: .upsert({...}, { onConflict, ignoreDuplicates }) → { error }
  const resultsUpsert = vi.fn().mockResolvedValue({ error: upsertError })

  let rpCallCount = 0
  const fromMock = vi.fn().mockImplementation((table: string) => {
    if (table === 'games') return { select: gameSelect }
    if (table === 'room_players') {
      const idx = rpCallCount++
      if (idx === 0) return { select: callerSelect }
      return { update: rpUpdate }
    }
    if (table === 'rounds') return { select: roundsSelect }
    if (table === 'round_scores') return { select: scoresSelect }
    if (table === 'game_results') return { upsert: resultsUpsert }
    throw new Error(`Unexpected table: ${table}`)
  })

  return { from: fromMock, rpUpdate, resultsUpsert }
}

beforeEach(() => {
  vi.resetAllMocks()
  ;(resolveDroppedTurnChain as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
})

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('POST /api/games/[gameId]/leave', () => {
  // ── Guard tests ─────────────────────────────────────────────────────────────
  it('returns 401 when unauthenticated', async () => {
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock(null))
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(makeAdminMock())
    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(401)
  })

  it('returns 404 when game is not found or not in progress', async () => {
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock())
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(makeAdminMock({ game: null }))
    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(404)
  })

  it('returns 403 when caller is not in this game', async () => {
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock())
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(
      makeAdminMock({ callerIsPlayer: false })
    )
    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(403)
  })

  // ── Idempotency ─────────────────────────────────────────────────────────────
  it('returns 200 already_dropped when conditional UPDATE matches 0 rows', async () => {
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock())
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(
      makeAdminMock({ dropRows: [] })
    )
    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('already_dropped')
  })

  it('returns 500 when the conditional UPDATE fails', async () => {
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock())
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(
      makeAdminMock({ dropError: { message: 'db error' } })
    )
    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(500)
  })

  it('does not call resolveDroppedTurnChain when drop is a no-op', async () => {
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock())
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(
      makeAdminMock({ dropRows: [] })
    )
    await POST(makeRequest(), makeParams())
    expect(resolveDroppedTurnChain).not.toHaveBeenCalled()
  })

  // ── Happy path ───────────────────────────────────────────────────────────────
  it('marks caller as dropped, inserts a loss game_results row, and returns { status: left }', async () => {
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock())
    const admin = makeAdminMock({ cumScores: [{ score: 30 }, { score: 20 }] })
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(admin)

    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('left')

    // UPDATE must set status='dropped' for the caller
    const updateArg = (admin.rpUpdate as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>
    expect(updateArg.status).toBe('dropped')

    // game_results must record a loss with cumulative total_score
    const upsertArg = (admin.resultsUpsert as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>
    expect(upsertArg.result).toBe('loss')
    expect(upsertArg.placement).toBe(0)
    expect(upsertArg.total_score).toBe(50)  // 30 + 20
    expect(upsertArg.player_id).toBe('player-1')
    expect(upsertArg.game_id).toBe('game-id')
  })

  it('records total_score = 0 when player has no round_scores yet', async () => {
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock())
    const admin = makeAdminMock({ cumScores: [] })
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(admin)

    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(200)
    const upsertArg = (admin.resultsUpsert as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>
    expect(upsertArg.total_score).toBe(0)
  })

  it('calls resolveDroppedTurnChain after successful drop', async () => {
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock())
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(makeAdminMock())

    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(200)

    expect(resolveDroppedTurnChain).toHaveBeenCalledWith(
      expect.anything(), // admin client
      'game-id',
      'room-id',
    )
  })
})
