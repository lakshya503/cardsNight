import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '../route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

function makeRequest(gameId = 'game-id', body: object = { amount: 2 }) {
  return new NextRequest(`http://localhost/api/games/${gameId}/bid`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

function makeParams(gameId = 'game-id') {
  return { params: Promise.resolve({ gameId }) }
}

// Minimal server mock — only needs auth
function makeServerMock(user: { id: string } | null = { id: 'player-1' }) {
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
  }
}

// Full admin mock for the happy path: 2 players, first bidder places bid
function makeAdminMock({
  game = { id: 'game-id', room_id: 'room-id', status: 'in_progress' } as
    { id: string; room_id: string; status: string } | null,
  roomPlayer = { id: 'rp-1' } as { id: string } | null,
  round = {
    id: 'round-id',
    round_number: 1,
    hand_size: 10,
    status: 'bidding',
    current_player_id: 'player-1',
  } as {
    id: string; round_number: number; hand_size: number
    status: string; current_player_id: string
  } | null,
  players = [
    { user_id: 'player-1', seat_order: 0 },
    { user_id: 'player-2', seat_order: 1 },
  ] as Array<{ user_id: string; seat_order: number }>,
  existingBids = [] as Array<{ amount: number }>,
  bidError = null as unknown,
  prevRoundId = null as string | null,
  lastTrickWinnerId = null as string | null,
} = {}) {
  // games: .from('games').select().eq().maybeSingle()
  const gameMaybeSingle = vi.fn().mockResolvedValue({ data: game })
  const gameEq = vi.fn().mockReturnValue({ maybeSingle: gameMaybeSingle })
  const gameSelect = vi.fn().mockReturnValue({ eq: gameEq })

  // room_players membership: .select().eq().eq().eq().maybeSingle()
  const rpMemberMaybeSingle = vi.fn().mockResolvedValue({ data: roomPlayer })
  const rpMemberEq3 = vi.fn().mockReturnValue({ maybeSingle: rpMemberMaybeSingle })
  const rpMemberEq2 = vi.fn().mockReturnValue({ eq: rpMemberEq3 })
  const rpMemberEq1 = vi.fn().mockReturnValue({ eq: rpMemberEq2 })
  const rpMemberSelect = vi.fn().mockReturnValue({ eq: rpMemberEq1 })

  // room_players seat list: .select().eq().eq().order()
  const rpListOrder = vi.fn().mockResolvedValue({ data: players })
  const rpListEq2 = vi.fn().mockReturnValue({ order: rpListOrder })
  const rpListEq1 = vi.fn().mockReturnValue({ eq: rpListEq2 })
  const rpListSelect = vi.fn().mockReturnValue({ eq: rpListEq1 })

  // room_players UPDATE: .update().eq()
  const rpUpdateEq = vi.fn().mockResolvedValue({})
  const rpUpdate = vi.fn().mockReturnValue({ eq: rpUpdateEq })

  // rounds SELECT (call 0): active bidding round
  // .select().eq('game_id').eq('status').order().limit().maybeSingle()
  const roundMaybeSingle = vi.fn().mockResolvedValue({ data: round })
  const roundLimit = vi.fn().mockReturnValue({ maybeSingle: roundMaybeSingle })
  const roundOrder = vi.fn().mockReturnValue({ limit: roundLimit })
  const roundEq2 = vi.fn().mockReturnValue({ order: roundOrder })
  const roundEq1 = vi.fn().mockReturnValue({ eq: roundEq2 })
  const roundSelect = vi.fn().mockReturnValue({ eq: roundEq1 })

  // rounds SELECT (call 1): previous round lookup (isLastBidder, round_number > 1)
  // .select('id').eq('game_id').eq('round_number').maybeSingle()
  const prevRoundData = prevRoundId ? { id: prevRoundId } : null
  const prevRoundMaybeSingle = vi.fn().mockResolvedValue({ data: prevRoundData })
  const prevRoundEq2 = vi.fn().mockReturnValue({ maybeSingle: prevRoundMaybeSingle })
  const prevRoundEq1 = vi.fn().mockReturnValue({ eq: prevRoundEq2 })
  const prevRoundSelect = vi.fn().mockReturnValue({ eq: prevRoundEq1 })

  // rounds UPDATE: .update().eq()
  const roundUpdateEq = vi.fn().mockResolvedValue({ error: null })
  const roundUpdate = vi.fn().mockReturnValue({ eq: roundUpdateEq })

  // bids SELECT: .select().eq()
  const bidsSelectEq = vi.fn().mockResolvedValue({ data: existingBids })
  const bidsSelect = vi.fn().mockReturnValue({ eq: bidsSelectEq })

  // bids INSERT
  const bidsInsert = vi.fn().mockResolvedValue({ error: bidError })

  // tricks INSERT (first trick of round)
  const tricksInsert = vi.fn().mockResolvedValue({ error: null })

  // tricks SELECT (last trick winner lookup):
  // .select('winner_id').eq('round_id').not().order().limit().maybeSingle()
  const lastTrickData = lastTrickWinnerId ? { winner_id: lastTrickWinnerId } : null
  const lastTrickMaybeSingle = vi.fn().mockResolvedValue({ data: lastTrickData })
  const lastTrickLimit = vi.fn().mockReturnValue({ maybeSingle: lastTrickMaybeSingle })
  const lastTrickOrder = vi.fn().mockReturnValue({ limit: lastTrickLimit })
  const lastTrickNot = vi.fn().mockReturnValue({ order: lastTrickOrder })
  const lastTrickEq = vi.fn().mockReturnValue({ not: lastTrickNot })
  const lastTrickSelect = vi.fn().mockReturnValue({ eq: lastTrickEq })

  // Route tracks which table is accessed sequentially; we need `from` to return
  // different mocks depending on which table is requested and call sequence.
  // Build a call-count-aware dispatcher.
  let rpCallCount = 0
  let roundsCallCount = 0
  let tricksCallCount = 0
  const rpMocks = [rpMemberSelect, rpListSelect]
  const rpUpdateMock = rpUpdate

  const fromMock = vi.fn().mockImplementation((table: string) => {
    if (table === 'games') return { select: gameSelect }
    if (table === 'room_players') {
      // first call = membership check, second call = seat list, third call = UPDATE
      const idx = rpCallCount++
      if (idx === 0) return { select: rpMocks[0] }
      if (idx === 1) return { select: rpMocks[1] }
      return { update: rpUpdateMock }
    }
    if (table === 'rounds') {
      const idx = roundsCallCount++
      if (idx === 0) return { select: roundSelect, update: roundUpdate }
      // Second rounds SELECT: previous round lookup (no order/limit chain)
      return { select: prevRoundSelect, update: roundUpdate }
    }
    if (table === 'bids') return { select: bidsSelect, insert: bidsInsert }
    if (table === 'tricks') {
      const idx = tricksCallCount++
      if (idx === 0) return { select: lastTrickSelect, insert: tricksInsert }
      return { insert: tricksInsert }
    }
    throw new Error(`Unexpected table: ${table}`)
  })

  return { from: fromMock }
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('POST /api/games/[gameId]/bid', () => {
  it('returns 401 when unauthenticated', async () => {
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock(null))
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(makeAdminMock())
    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(401)
  })

  it('returns 400 when amount is not a number', async () => {
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock())
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(makeAdminMock())
    const res = await POST(makeRequest('game-id', { amount: 'two' }), makeParams())
    expect(res.status).toBe(400)
  })

  it('returns 404 when game is not found', async () => {
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock())
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(makeAdminMock({ game: null }))
    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(404)
  })

  it('returns 403 when user is not a player in the room', async () => {
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock())
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(makeAdminMock({ roomPlayer: null }))
    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(403)
  })

  it('returns 422 when there is no active bidding round', async () => {
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock())
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(makeAdminMock({ round: null }))
    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toMatch(/No active bidding round/)
  })

  it('returns 422 when it is not the player\'s turn', async () => {
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock({ id: 'player-2' }))
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(
      makeAdminMock({ round: { id: 'r', round_number: 1, hand_size: 10, status: 'bidding', current_player_id: 'player-1' } })
    )
    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toMatch(/Not your turn/)
  })

  it('returns 422 for an invalid bid amount', async () => {
    // hand_size=10, existingBids=[5], isLastBidder=true, forbidden=5 → amount 5 is invalid
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock({ id: 'player-2' }))
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(
      makeAdminMock({
        round: { id: 'r', round_number: 1, hand_size: 10, status: 'bidding', current_player_id: 'player-2' },
        existingBids: [{ amount: 5 }],
      })
    )
    const res = await POST(makeRequest('game-id', { amount: 5 }), makeParams())
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toMatch(/Invalid bid/)
    expect(body.forbidden).toBe(5)
  })

  it('returns 200 and advances current_player_id when not the last bidder', async () => {
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock({ id: 'player-1' }))
    const adminMock = makeAdminMock()
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(adminMock)
    const res = await POST(makeRequest('game-id', { amount: 2 }), makeParams())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('bidding')

    // turn_started_at must be included in the rounds UPDATE (advance to next bidder)
    const fromCalls = (adminMock.from as ReturnType<typeof vi.fn>).mock.calls
    const fromResults = (adminMock.from as ReturnType<typeof vi.fn>).mock.results
    let updateArg: Record<string, unknown> | null = null
    for (let i = 0; i < fromCalls.length; i++) {
      if (fromCalls[i][0] === 'rounds') {
        const result = fromResults[i].value as { update?: ReturnType<typeof vi.fn> }
        if (result.update && (result.update as ReturnType<typeof vi.fn>).mock?.calls?.length > 0) {
          updateArg = (result.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>
          break
        }
      }
    }
    expect(updateArg).not.toBeNull()
    expect(typeof updateArg!.turn_started_at).toBe('string')
  })

  it('returns 200 with status playing and inserts trick when last bidder bids', async () => {
    // player-2 is last bidder (existingBids has player-1's bid already)
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock({ id: 'player-2' }))
    const adminMock = makeAdminMock({
      round: { id: 'r', round_number: 1, hand_size: 10, status: 'bidding', current_player_id: 'player-2' },
      existingBids: [{ amount: 3 }],
    })
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(adminMock)
    // amount=2: forbidden=10-3=7, 2 is valid
    const res = await POST(makeRequest('game-id', { amount: 2 }), makeParams())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('playing')

    // turn_started_at must be included in the rounds UPDATE (transition to playing)
    const fromCalls = (adminMock.from as ReturnType<typeof vi.fn>).mock.calls
    const fromResults = (adminMock.from as ReturnType<typeof vi.fn>).mock.results
    let updateArg: Record<string, unknown> | null = null
    for (let i = 0; i < fromCalls.length; i++) {
      if (fromCalls[i][0] === 'rounds') {
        const result = fromResults[i].value as { update?: ReturnType<typeof vi.fn> }
        if (result.update && (result.update as ReturnType<typeof vi.fn>).mock?.calls?.length > 0) {
          updateArg = (result.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>
          break
        }
      }
    }
    expect(updateArg).not.toBeNull()
    expect(typeof updateArg!.turn_started_at).toBe('string')
  })

  it('sets first trick leader to previous round last trick winner when last bidder bids in round 2', async () => {
    // Round 2, player-2 is last bidder.
    // Previous round's last trick winner was player-1.
    // current_player_id on the round update should be player-1, not seat rotation.
    // Seat rotation: (round_number - 1) % players.length = (2 - 1) % 2 = 1 → player-2
    // Correct: player-1 (last trick winner of round 1)
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock({ id: 'player-2' }))
    const adminMock = makeAdminMock({
      round: { id: 'round-2-id', round_number: 2, hand_size: 9, status: 'bidding', current_player_id: 'player-2' },
      existingBids: [{ amount: 3 }],
      prevRoundId: 'round-1-id',
      lastTrickWinnerId: 'player-1',
    })
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(adminMock)

    const res = await POST(makeRequest('game-id', { amount: 2 }), makeParams())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('playing')

    // Find the rounds UPDATE call and verify current_player_id = 'player-1'
    const fromCalls = (adminMock.from as ReturnType<typeof vi.fn>).mock.calls
    const fromResults = (adminMock.from as ReturnType<typeof vi.fn>).mock.results
    let updateArg: Record<string, unknown> | null = null
    for (let i = 0; i < fromCalls.length; i++) {
      if (fromCalls[i][0] === 'rounds') {
        const result = fromResults[i].value as { update?: ReturnType<typeof vi.fn> }
        if (result.update && (result.update as ReturnType<typeof vi.fn>).mock?.calls?.length > 0) {
          updateArg = (result.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>
          break
        }
      }
    }

    expect(updateArg).not.toBeNull()
    expect(updateArg!.current_player_id).toBe('player-1')
  })
})
