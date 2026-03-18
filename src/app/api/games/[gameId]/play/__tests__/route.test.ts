import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '../route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

function makeRequest(gameId = 'game-id', body: object = { suit: 'hearts', value: 'A' }) {
  return new NextRequest(`http://localhost/api/games/${gameId}/play`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

function makeParams(gameId = 'game-id') {
  return { params: Promise.resolve({ gameId }) }
}

function makeServerMock(user: { id: string } | null = { id: 'player-1' }) {
  return { auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) } }
}

// Default test fixtures
const DEFAULT_GAME = { id: 'game-id', room_id: 'room-id', status: 'in_progress' }
const DEFAULT_ROOM_PLAYER = { id: 'rp-1' }
const DEFAULT_ROUND = {
  id: 'round-id', round_number: 1, hand_size: 2,
  trump_suit: 'spades', status: 'playing', current_player_id: 'player-1',
}
const DEFAULT_PLAYERS = [
  { user_id: 'player-1', seat_order: 0 },
  { user_id: 'player-2', seat_order: 1 },
]
// player-1 has hearts:A and hearts:K; neither has been played
const DEFAULT_HAND_ROW = { cards: [{ suit: 'hearts', value: 'A' }, { suit: 'hearts', value: 'K' }] }
// Two tricks exist (trick 1 complete, trick 2 active)
const DEFAULT_TRICKS: Array<{ id: string; trick_number: number; led_suit: string | null; winner_id: string | null }> = [
  { id: 'trick-1', trick_number: 1, led_suit: 'hearts', winner_id: 'player-2' },
  { id: 'trick-2', trick_number: 2, led_suit: null, winner_id: null },
]
// player-1 already played hearts:K in trick-1
const DEFAULT_PLAYED_BY_PLAYER = [{ suit: 'hearts', value: 'K' }]
// No cards yet in trick-2
const DEFAULT_EXISTING_TRICK_CARDS: Array<{ player_id: string; suit: string; value: string }> = []

// Builds a minimal admin mock. Override specific tables via options.
function makeAdminMock({
  game = DEFAULT_GAME as typeof DEFAULT_GAME | null,
  roomPlayer = DEFAULT_ROOM_PLAYER as { id: string } | null,
  round = DEFAULT_ROUND as typeof DEFAULT_ROUND | null,
  players = DEFAULT_PLAYERS,
  allTricks = DEFAULT_TRICKS,
  handRow = DEFAULT_HAND_ROW as { cards: Array<{ suit: string; value: string }> } | null,
  playedByPlayer = DEFAULT_PLAYED_BY_PLAYER,
  existingTrickCards = DEFAULT_EXISTING_TRICK_CARDS,
  trickCardInsertError = null as unknown,
  tricksUpdateError = null as unknown,
} = {}) {
  // games
  const gameMaybeSingle = vi.fn().mockResolvedValue({ data: game })
  const gameEq = vi.fn().mockReturnValue({ maybeSingle: gameMaybeSingle })
  const gameSelect = vi.fn().mockReturnValue({ eq: gameEq })

  // room_players membership
  const rpMemberMaybeSingle = vi.fn().mockResolvedValue({ data: roomPlayer })
  const rpMemberEq3 = vi.fn().mockReturnValue({ maybeSingle: rpMemberMaybeSingle })
  const rpMemberEq2 = vi.fn().mockReturnValue({ eq: rpMemberEq3 })
  const rpMemberEq1 = vi.fn().mockReturnValue({ eq: rpMemberEq2 })
  const rpMemberSelect = vi.fn().mockReturnValue({ eq: rpMemberEq1 })

  // room_players seat list
  const rpListOrder = vi.fn().mockResolvedValue({ data: players })
  const rpListEq2 = vi.fn().mockReturnValue({ order: rpListOrder })
  const rpListEq1 = vi.fn().mockReturnValue({ eq: rpListEq2 })
  const rpListSelect = vi.fn().mockReturnValue({ eq: rpListEq1 })

  // room_players UPDATE (for advancing turn)
  const rpUpdateEq = vi.fn().mockResolvedValue({ error: null })
  const rpUpdate = vi.fn().mockReturnValue({ eq: rpUpdateEq })

  // rounds SELECT
  const roundMaybeSingle = vi.fn().mockResolvedValue({ data: round })
  const roundLimit = vi.fn().mockReturnValue({ maybeSingle: roundMaybeSingle })
  const roundOrder = vi.fn().mockReturnValue({ limit: roundLimit })
  const roundEq2 = vi.fn().mockReturnValue({ order: roundOrder })
  const roundEq1 = vi.fn().mockReturnValue({ eq: roundEq2 })
  const roundSelect = vi.fn().mockReturnValue({ eq: roundEq1 })

  // rounds UPDATE
  const roundUpdateEq = vi.fn().mockResolvedValue({ error: null })
  const roundUpdate = vi.fn().mockReturnValue({ eq: roundUpdateEq })

  // tricks SELECT (all tricks for round)
  const tricksSelectOrder = vi.fn().mockResolvedValue({ data: allTricks })
  const tricksSelectEq = vi.fn().mockReturnValue({ order: tricksSelectOrder })
  const tricksSelectSelect = vi.fn().mockReturnValue({ eq: tricksSelectEq })

  // tricks UPDATE (led_suit and winner_id)
  const tricksUpdateEq = vi.fn().mockResolvedValue({ error: tricksUpdateError })
  const tricksUpdate = vi.fn().mockReturnValue({ eq: tricksUpdateEq })

  // tricks INSERT (next trick)
  const tricksInsert = vi.fn().mockResolvedValue({ error: null })

  // hands
  const handsMaybeSingle = vi.fn().mockResolvedValue({ data: handRow })
  const handsEq2 = vi.fn().mockReturnValue({ maybeSingle: handsMaybeSingle })
  const handsEq1 = vi.fn().mockReturnValue({ eq: handsEq2 })
  const handsSelect = vi.fn().mockReturnValue({ eq: handsEq1 })

  // trick_cards SELECT played by player: .select().eq('player_id').in('trick_id')
  const tcPlayedIn = vi.fn().mockResolvedValue({ data: playedByPlayer })
  const tcPlayedEq = vi.fn().mockReturnValue({ in: tcPlayedIn })
  const tcPlayedSelect = vi.fn().mockReturnValue({ eq: tcPlayedEq })

  // trick_cards SELECT existing in current trick
  const tcExistingEq = vi.fn().mockResolvedValue({ data: existingTrickCards })
  const tcExistingSelect = vi.fn().mockReturnValue({ eq: tcExistingEq })

  // trick_cards INSERT
  const tcInsert = vi.fn().mockResolvedValue({ error: trickCardInsertError })

  let rpCallCount = 0
  let tcSelectCallCount = 0
  let tricksCallCount = 0

  const fromMock = vi.fn().mockImplementation((table: string) => {
    if (table === 'games') return { select: gameSelect }
    if (table === 'room_players') {
      const idx = rpCallCount++
      if (idx === 0) return { select: rpMemberSelect }
      if (idx === 1) return { select: rpListSelect }
      return { update: rpUpdate }
    }
    if (table === 'rounds') return { select: roundSelect, update: roundUpdate }
    if (table === 'tricks') {
      const idx = tricksCallCount++
      if (idx === 0) return { select: tricksSelectSelect, update: tricksUpdate, insert: tricksInsert }
      return { update: tricksUpdate, insert: tricksInsert }
    }
    if (table === 'hands') return { select: handsSelect }
    if (table === 'trick_cards') {
      const idx = tcSelectCallCount++
      if (idx === 0) return { select: tcPlayedSelect }
      if (idx === 1) return { select: tcExistingSelect }
      return { insert: tcInsert } // idx 2: the INSERT
    }
    throw new Error(`Unexpected table: ${table}`)
  })

  return { from: fromMock }
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('POST /api/games/[gameId]/play', () => {
  it('returns 401 when unauthenticated', async () => {
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock(null))
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(makeAdminMock())
    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(401)
  })

  it('returns 400 when body is missing suit/value', async () => {
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock())
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(makeAdminMock())
    const res = await POST(makeRequest('game-id', { suit: 'hearts' }), makeParams())
    expect(res.status).toBe(400)
  })

  it('returns 404 when game not found', async () => {
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

  it('returns 422 when no active playing round', async () => {
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock())
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(makeAdminMock({ round: null }))
    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(422)
    expect((await res.json()).error).toMatch(/No active playing round/)
  })

  it('returns 422 when it is not the player\'s turn', async () => {
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock({ id: 'player-2' }))
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(makeAdminMock())
    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(422)
    expect((await res.json()).error).toMatch(/Not your turn/)
  })

  it('returns 422 when card is not in hand', async () => {
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock())
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(makeAdminMock())
    // hearts:K was played already (DEFAULT_PLAYED_BY_PLAYER), so only hearts:A remains
    // clubs:2 is not in hand at all
    const res = await POST(makeRequest('game-id', { suit: 'clubs', value: '2' }), makeParams())
    expect(res.status).toBe(422)
    expect((await res.json()).error).toMatch(/Invalid play/)
  })

  it('returns 422 when player does not follow suit', async () => {
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock({ id: 'player-2' }))
    // player-2's turn, hearts led, player-2 has hearts:Q but tries to play spades:2
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(
      makeAdminMock({
        round: { ...DEFAULT_ROUND, current_player_id: 'player-2' },
        handRow: { cards: [{ suit: 'hearts', value: 'Q' }, { suit: 'spades', value: '2' }] },
        playedByPlayer: [],
        existingTrickCards: [{ player_id: 'player-1', suit: 'hearts', value: 'A' }],
      })
    )
    const res = await POST(makeRequest('game-id', { suit: 'spades', value: '2' }), makeParams())
    expect(res.status).toBe(422)
    expect((await res.json()).error).toMatch(/Invalid play/)
  })

  it('returns 200 trick_in_progress when not the last card in the trick', async () => {
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock())
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(makeAdminMock())
    // Only 1 of 2 players has played — existingTrickCards is empty, so player-1 leads
    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('trick_in_progress')
  })

  it('returns 200 trick_complete with winnerId when last card in trick and more tricks remain', async () => {
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock({ id: 'player-2' }))
    // player-2 plays the last card; trick-1 is done, trick-2 is active; hand_size=2 so trick 2 is the last
    // but let's set hand_size=3 so more tricks remain after trick 2
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(
      makeAdminMock({
        round: { ...DEFAULT_ROUND, hand_size: 3, current_player_id: 'player-2' },
        handRow: { cards: [{ suit: 'hearts', value: '3' }] },
        playedByPlayer: [],
        existingTrickCards: [{ player_id: 'player-1', suit: 'hearts', value: 'A' }],
      })
    )
    // player-2 plays hearts:3; player-1 had hearts:A which beats it
    const res = await POST(makeRequest('game-id', { suit: 'hearts', value: '3' }), makeParams())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('trick_complete')
    expect(body.winnerId).toBe('player-1') // A beats 3
  })

  it('returns 200 round_complete when last trick of the round is completed', async () => {
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock({ id: 'player-2' }))
    // hand_size=2, trick_number=2 — this is the last trick
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(
      makeAdminMock({
        round: { ...DEFAULT_ROUND, hand_size: 2, current_player_id: 'player-2' },
        allTricks: [
          { id: 'trick-1', trick_number: 1, led_suit: 'hearts', winner_id: 'player-2' },
          { id: 'trick-2', trick_number: 2, led_suit: 'hearts', winner_id: null },
        ],
        handRow: { cards: [{ suit: 'hearts', value: '3' }] },
        playedByPlayer: [],
        existingTrickCards: [{ player_id: 'player-1', suit: 'hearts', value: 'A' }],
      })
    )
    const res = await POST(makeRequest('game-id', { suit: 'hearts', value: '3' }), makeParams())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('round_complete')
    expect(body.winnerId).toBe('player-1')
  })
})
