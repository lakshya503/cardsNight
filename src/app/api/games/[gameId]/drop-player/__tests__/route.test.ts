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

const NOW = new Date('2026-03-21T10:00:00.000Z').getTime()
const DISCONNECTED_61S_AGO = new Date(NOW - 61_000).toISOString()
const DISCONNECTED_30S_AGO = new Date(NOW - 30_000).toISOString()

function makeRequest(gameId = 'game-id', body: Record<string, unknown> = { disconnectedUserId: 'player-2' }) {
  return new NextRequest(`http://localhost/api/games/${gameId}/drop-player`, {
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

type TargetPlayer = { id: string; status: string; disconnected_at: string | null } | null

// ─── Admin mock factory ───────────────────────────────────────────────────────
function makeAdminMock({
  game = DEFAULT_GAME as typeof DEFAULT_GAME | null,
  callerIsPlayer = true,
  targetPlayer = {
    id: 'rp-2',
    status: 'disconnected',
    disconnected_at: DISCONNECTED_61S_AGO,
  } as TargetPlayer,
  dropRows = [{ id: 'rp-2' }] as Array<{ id: string }>,
  dropError = null as unknown,
  // game round IDs (Fix 1.1 — scope round_scores to this game's rounds)
  gameRoundIds = [{ id: 'round-1' }] as Array<{ id: string }>,
  cumScores = [{ score: 30 }, { score: 20 }] as Array<{ score: number }>,
  // idempotent game_results check (Fix 1.4)
  existingGameResult = null as { id: string } | null,
  insertError = null as unknown,
} = {}) {
  // games SELECT: .select().eq().maybeSingle()
  const gameMaybeSingle = vi.fn().mockResolvedValue({ data: game })
  const gameEq = vi.fn().mockReturnValue({ maybeSingle: gameMaybeSingle })
  const gameSelect = vi.fn().mockReturnValue({ eq: gameEq })

  // room_players SELECT (caller): .select().eq().eq().eq().maybeSingle()
  const callerMaybeSingle = vi.fn().mockResolvedValue({ data: callerIsPlayer ? { id: 'rp-1' } : null })
  const callerEq3 = vi.fn().mockReturnValue({ maybeSingle: callerMaybeSingle })
  const callerEq2 = vi.fn().mockReturnValue({ eq: callerEq3 })
  const callerEq1 = vi.fn().mockReturnValue({ eq: callerEq2 })
  const callerSelect = vi.fn().mockReturnValue({ eq: callerEq1 })

  // room_players SELECT (target): .select().eq().eq().maybeSingle()
  const targetMaybeSingle = vi.fn().mockResolvedValue({ data: targetPlayer })
  const targetEq2 = vi.fn().mockReturnValue({ maybeSingle: targetMaybeSingle })
  const targetEq1 = vi.fn().mockReturnValue({ eq: targetEq2 })
  const targetSelect = vi.fn().mockReturnValue({ eq: targetEq1 })

  // room_players UPDATE (conditional): .update().eq().eq().eq().select('id')
  const dropSelectId = vi.fn().mockResolvedValue({ data: dropRows, error: dropError })
  const dropEq3 = vi.fn().mockReturnValue({ select: dropSelectId })
  const dropEq2 = vi.fn().mockReturnValue({ eq: dropEq3 })
  const dropEq1 = vi.fn().mockReturnValue({ eq: dropEq2 })
  const rpUpdate = vi.fn().mockReturnValue({ eq: dropEq1 })

  // rounds SELECT (game round IDs, Fix 1.1): .select('id').eq('game_id', gameId)
  const roundsEq = vi.fn().mockResolvedValue({ data: gameRoundIds })
  const roundsSelect = vi.fn().mockReturnValue({ eq: roundsEq })

  // round_scores SELECT (Fix 1.1 + scoped): .select('score').in('round_id', [...]).eq('player_id', id)
  const scoresEqPlayerId = vi.fn().mockResolvedValue({ data: cumScores })
  const scoresIn = vi.fn().mockReturnValue({ eq: scoresEqPlayerId })
  const scoresSelect = vi.fn().mockReturnValue({ in: scoresIn })

  // game_results SELECT (idempotency check, Fix 1.4): .select('id').eq('game_id').eq('player_id').maybeSingle()
  const grCheckMaybeSingle = vi.fn().mockResolvedValue({ data: existingGameResult })
  const grCheckEq2 = vi.fn().mockReturnValue({ maybeSingle: grCheckMaybeSingle })
  const grCheckEq1 = vi.fn().mockReturnValue({ eq: grCheckEq2 })
  const grCheckSelect = vi.fn().mockReturnValue({ eq: grCheckEq1 })

  // game_results INSERT: .insert({...}) → { error }
  const resultsInsert = vi.fn().mockResolvedValue({ error: insertError })

  let rpCallCount = 0
  const fromMock = vi.fn().mockImplementation((table: string) => {
    if (table === 'games') return { select: gameSelect }
    if (table === 'room_players') {
      const idx = rpCallCount++
      if (idx === 0) return { select: callerSelect }
      if (idx === 1) return { select: targetSelect }
      return { update: rpUpdate }
    }
    if (table === 'rounds') return { select: roundsSelect }
    if (table === 'round_scores') return { select: scoresSelect }
    if (table === 'game_results') return { select: grCheckSelect, insert: resultsInsert }
    throw new Error(`Unexpected table: ${table}`)
  })

  return { from: fromMock, rpUpdate, resultsInsert, grCheckSelect }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  // Reset resolveDroppedTurnChain mock
  ;(resolveDroppedTurnChain as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
})

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('POST /api/games/[gameId]/drop-player', () => {
  // ── Guard tests ─────────────────────────────────────────────────────────────
  it('returns 401 when unauthenticated', async () => {
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock(null))
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(makeAdminMock())
    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(401)
  })

  it('returns 400 when disconnectedUserId is missing from body', async () => {
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock())
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(makeAdminMock())
    const res = await POST(makeRequest('game-id', {}), makeParams())
    expect(res.status).toBe(400)
  })

  it('returns 400 when caller tries to drop themselves (Fix 1.2 — self-drop guard)', async () => {
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock({ id: 'player-1' }))
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(makeAdminMock())
    // player-1 trying to drop player-1 (same as user.id)
    const res = await POST(makeRequest('game-id', { disconnectedUserId: 'player-1' }), makeParams())
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/cannot drop yourself/i)
  })

  it('returns 404 when game is not found or not in progress', async () => {
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

  it('returns 404 when the target player is not found in the room', async () => {
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock())
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(
      makeAdminMock({ targetPlayer: null })
    )
    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(404)
  })

  it('returns 422 when the target player is still active (not disconnected)', async () => {
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock())
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(
      makeAdminMock({
        targetPlayer: { id: 'rp-2', status: 'active', disconnected_at: null },
      })
    )
    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(422)
  })

  it('returns 422 with too_early when disconnected < 60s ago', async () => {
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock())
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(
      makeAdminMock({
        targetPlayer: { id: 'rp-2', status: 'disconnected', disconnected_at: DISCONNECTED_30S_AGO },
      })
    )
    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.status).toBe('too_early')
  })

  it('returns 200 already_dropped when player is already dropped (status check)', async () => {
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock())
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(
      makeAdminMock({
        targetPlayer: { id: 'rp-2', status: 'dropped', disconnected_at: DISCONNECTED_61S_AGO },
      })
    )
    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('already_dropped')
  })

  it('returns 200 already_dropped when conditional UPDATE matches 0 rows (concurrent call)', async () => {
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock())
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(
      makeAdminMock({ dropRows: [] })
    )
    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('already_dropped')
  })

  it('returns 500 when the UPDATE fails with a DB error', async () => {
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock())
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(
      makeAdminMock({ dropError: { message: 'DB error' } })
    )
    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(500)
  })

  // ── Happy path ───────────────────────────────────────────────────────────────
  it('marks the player as dropped, inserts a loss game_results row, and returns { status: dropped }', async () => {
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock())
    const admin = makeAdminMock({ cumScores: [{ score: 30 }, { score: 20 }] })
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(admin)

    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('dropped')

    // UPDATE must target room_id, user_id, status='disconnected'
    const updateArg = (admin.rpUpdate as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>
    expect(updateArg.status).toBe('dropped')

    // game_results must record a loss with cumulative total_score
    const insertArg = (admin.resultsInsert as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>
    expect(insertArg.result).toBe('loss')
    expect(insertArg.total_score).toBe(50)   // 30 + 20
    expect(insertArg.player_id).toBe('player-2')
    expect(insertArg.game_id).toBe('game-id')
  })

  it('records total_score = 0 when player has no round_scores yet', async () => {
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock())
    const admin = makeAdminMock({ cumScores: [] })
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(admin)

    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(200)
    const insertArg = (admin.resultsInsert as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>
    expect(insertArg.total_score).toBe(0)
  })

  it('scopes round_scores query to this game only (Fix 1.1 — cross-game contamination)', async () => {
    // Verify that the rounds SELECT is called first to get game round IDs,
    // and round_scores uses .in('round_id', ...) scoped to this game.
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock())
    const admin = makeAdminMock({ gameRoundIds: [{ id: 'round-1' }, { id: 'round-2' }] })
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(admin)

    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(200)

    // rounds SELECT must have been called (to get game round IDs)
    const allCalls = (admin.from as ReturnType<typeof vi.fn>).mock.calls as string[][]
    const roundsFromCall = allCalls.find((args) => args[0] === 'rounds')
    expect(roundsFromCall).toBeDefined()

    // round_scores SELECT must use .in() (scoped to game round IDs)
    const scoresFromCall = allCalls.find((args) => args[0] === 'round_scores')
    expect(scoresFromCall).toBeDefined()
  })

  it('skips game_results insert when row already exists (Fix 1.4 — idempotent)', async () => {
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock())
    const admin = makeAdminMock({ existingGameResult: { id: 'existing-result' } })
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(admin)

    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('dropped')

    // game_results INSERT must NOT have been called since row exists
    expect(admin.resultsInsert).not.toHaveBeenCalled()
  })

  it('calls resolveDroppedTurnChain after successful drop (Fix 1.3)', async () => {
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

  it('does not call resolveDroppedTurnChain when drop is a no-op (already_dropped)', async () => {
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock())
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(
      makeAdminMock({ dropRows: [] }) // concurrent call — UPDATE matched 0 rows
    )

    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('already_dropped')

    // No resolveDroppedTurnChain since drop was a no-op
    expect(resolveDroppedTurnChain).not.toHaveBeenCalled()
  })
})
