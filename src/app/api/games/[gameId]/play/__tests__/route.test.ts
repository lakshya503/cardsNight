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
  // Scoring-path additions (only reached when last card of last trick)
  roundBids = [] as Array<{ player_id: string; amount: number }>,
  completedTricks = [] as Array<{ winner_id: string | null }>,
  // Game-completion-path additions (only reached when hand_size === 1)
  allGameRoundIds = [] as Array<{ id: string }>,
  allGameScores = [] as Array<{ player_id: string; score: number }>,
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

  // rounds INSERT (for next round after scoring)
  const roundInsertSingle = vi.fn().mockResolvedValue({ data: { id: 'next-round-id' }, error: null })
  const roundInsertSelect = vi.fn().mockReturnValue({ single: roundInsertSingle })
  const roundInsert = vi.fn().mockReturnValue({ select: roundInsertSelect })

  // tricks SELECT call 0: all tricks for round (.select().eq().order())
  const tricksSelectOrder = vi.fn().mockResolvedValue({ data: allTricks })
  const tricksSelectEq = vi.fn().mockReturnValue({ order: tricksSelectOrder })
  const tricksAllSelect = vi.fn().mockReturnValue({ eq: tricksSelectEq })

  // tricks SELECT call 1 (scoring): completed tricks (.select().eq().not())
  const tricksCompletedNot = vi.fn().mockResolvedValue({ data: completedTricks })
  const tricksCompletedEq = vi.fn().mockReturnValue({ not: tricksCompletedNot })
  const tricksCompletedSelect = vi.fn().mockReturnValue({ eq: tricksCompletedEq })

  // tricks UPDATE (led_suit / winner_id) and INSERT (next trick)
  const tricksUpdateEq = vi.fn().mockResolvedValue({ error: tricksUpdateError })
  const tricksUpdate = vi.fn().mockReturnValue({ eq: tricksUpdateEq })
  const tricksInsert = vi.fn().mockResolvedValue({ error: null })

  // hands SELECT
  const handsMaybeSingle = vi.fn().mockResolvedValue({ data: handRow })
  const handsEq2 = vi.fn().mockReturnValue({ maybeSingle: handsMaybeSingle })
  const handsEq1 = vi.fn().mockReturnValue({ eq: handsEq2 })
  const handsSelect = vi.fn().mockReturnValue({ eq: handsEq1 })

  // hands INSERT (for next round)
  const handsInsert = vi.fn().mockResolvedValue({ error: null })

  // trick_cards SELECT played by player: .select().eq('player_id').in('trick_id')
  const tcPlayedIn = vi.fn().mockResolvedValue({ data: playedByPlayer })
  const tcPlayedEq = vi.fn().mockReturnValue({ in: tcPlayedIn })
  const tcPlayedSelect = vi.fn().mockReturnValue({ eq: tcPlayedEq })

  // trick_cards SELECT existing in current trick
  const tcExistingEq = vi.fn().mockResolvedValue({ data: existingTrickCards })
  const tcExistingSelect = vi.fn().mockReturnValue({ eq: tcExistingEq })

  // trick_cards INSERT
  const tcInsert = vi.fn().mockResolvedValue({ error: trickCardInsertError })

  // bids SELECT (scoring path): .select().eq()
  const bidsSelectEq = vi.fn().mockResolvedValue({ data: roundBids })
  const bidsSelect = vi.fn().mockReturnValue({ eq: bidsSelectEq })

  // round_scores INSERT (scoring path)
  const rsInsert = vi.fn().mockResolvedValue({ error: null })

  // game_results INSERT (game completion path)
  const gameResultsInsert = vi.fn().mockResolvedValue({ error: null })

  // games UPDATE (game completion path)
  const gamesUpdateEq = vi.fn().mockResolvedValue({ error: null })
  const gamesUpdate = vi.fn().mockReturnValue({ eq: gamesUpdateEq })

  // rounds SELECT all IDs for game (game completion path): .select('id').eq('game_id', ...)
  const allRoundsEq = vi.fn().mockResolvedValue({ data: allGameRoundIds })
  const allRoundsSelect = vi.fn().mockReturnValue({ eq: allRoundsEq })

  // round_scores SELECT all for game (game completion path): .select().in()
  const rsSelectIn = vi.fn().mockResolvedValue({ data: allGameScores })
  const rsSelect = vi.fn().mockReturnValue({ in: rsSelectIn })

  let rpCallCount = 0
  let tcSelectCallCount = 0
  let tricksCallCount = 0
  let roundsSelectCallCount = 0
  let rsCallCount = 0

  const fromMock = vi.fn().mockImplementation((table: string) => {
    if (table === 'games') return { select: gameSelect, update: gamesUpdate }
    if (table === 'game_results') return { insert: gameResultsInsert }
    if (table === 'room_players') {
      const idx = rpCallCount++
      if (idx === 0) return { select: rpMemberSelect }
      if (idx === 1) return { select: rpListSelect }
      return { update: rpUpdate }
    }
    if (table === 'rounds') {
      const idx = roundsSelectCallCount++
      // Call 0: playing-round SELECT (order/limit/maybeSingle)
      // Call 1: all round IDs for game (game completion path — just .eq())
      if (idx === 0) return { select: roundSelect, update: roundUpdate, insert: roundInsert }
      return { select: allRoundsSelect, update: roundUpdate, insert: roundInsert }
    }
    if (table === 'tricks') {
      const idx = tricksCallCount++
      if (idx === 0) return { select: tricksAllSelect, update: tricksUpdate, insert: tricksInsert }
      if (idx === 1) return { select: tricksCompletedSelect, update: tricksUpdate, insert: tricksInsert }
      return { select: tricksCompletedSelect, update: tricksUpdate, insert: tricksInsert }
    }
    if (table === 'hands') return { select: handsSelect, insert: handsInsert }
    if (table === 'trick_cards') {
      const idx = tcSelectCallCount++
      if (idx === 0) return { select: tcPlayedSelect }
      if (idx === 1) return { select: tcExistingSelect }
      return { insert: tcInsert } // idx 2: the INSERT
    }
    if (table === 'bids') return { select: bidsSelect }
    if (table === 'round_scores') {
      const idx = rsCallCount++
      if (idx === 0) return { insert: rsInsert }  // scoring: INSERT
      return { select: rsSelect }                  // game completion: SELECT all scores
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
    const adminMock = makeAdminMock()
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(adminMock)
    // Only 1 of 2 players has played — existingTrickCards is empty, so player-1 leads
    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('trick_in_progress')

    // turn_started_at must be included in the rounds UPDATE (advance to next player in trick)
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
    expect(updateArg!.turn_started_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })

  it('returns 200 trick_complete with winnerId when last card in trick and more tricks remain', async () => {
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock({ id: 'player-2' }))
    // player-2 plays the last card; trick-1 is done, trick-2 is active; hand_size=2 so trick 2 is the last
    // but let's set hand_size=3 so more tricks remain after trick 2
    const adminMock = makeAdminMock({
      round: { ...DEFAULT_ROUND, hand_size: 3, current_player_id: 'player-2' },
      handRow: { cards: [{ suit: 'hearts', value: '3' }] },
      playedByPlayer: [],
      existingTrickCards: [{ player_id: 'player-1', suit: 'hearts', value: 'A' }],
    })
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(adminMock)
    // player-2 plays hearts:3; player-1 had hearts:A which beats it
    const res = await POST(makeRequest('game-id', { suit: 'hearts', value: '3' }), makeParams())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('trick_complete')
    expect(body.winnerId).toBe('player-1') // A beats 3

    // turn_started_at must be included in the rounds UPDATE (set trick winner as next leader)
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
    expect(updateArg!.turn_started_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
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

  it('returns 200 game_complete on the last trick of the last round (hand_size=1)', async () => {
    // This is the scenario that was broken: hand_size=1 means there is only one trick.
    // When the last card is played the route must:
    //   1. score the round  (round_scores INSERT)
    //   2. update round to 'complete'  ← was failing because DB constraint said 'finished'
    //   3. fetch all round scores and insert game_results
    //   4. update game to 'finished'
    //   5. return { status: 'game_complete' }
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock({ id: 'player-2' }))
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(
      makeAdminMock({
        round: { ...DEFAULT_ROUND, hand_size: 1, current_player_id: 'player-2' },
        allTricks: [
          { id: 'trick-1', trick_number: 1, led_suit: 'hearts', winner_id: null },
        ],
        handRow: { cards: [{ suit: 'hearts', value: '3' }] },
        playedByPlayer: [],
        existingTrickCards: [{ player_id: 'player-1', suit: 'hearts', value: 'A' }],
        roundBids: [
          { player_id: 'player-1', amount: 1 },
          { player_id: 'player-2', amount: 0 },
        ],
        completedTricks: [], // none yet — the current trick hasn't been counted yet in this query
        allGameRoundIds: [{ id: 'round-id' }],
        allGameScores: [
          { player_id: 'player-1', score: 10 },
          { player_id: 'player-2', score: 10 },
        ],
      })
    )
    const res = await POST(makeRequest('game-id', { suit: 'hearts', value: '3' }), makeParams())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('game_complete')
    expect(body.winnerId).toBe('player-1') // A beats 3
  })

  it('sets next round current_player_id to the trick winner, not seat rotation', async () => {
    // hand_size=2, trick_number=2 = last trick of the round
    // player-2 plays the last card; player-1 wins the trick (A beats 3)
    // player-1 should be current_player_id in the next round insert (not seat rotation)
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock({ id: 'player-2' }))
    const adminMock = makeAdminMock({
      round: { ...DEFAULT_ROUND, hand_size: 2, current_player_id: 'player-2' },
      allTricks: [
        { id: 'trick-1', trick_number: 1, led_suit: 'hearts', winner_id: 'player-2' },
        { id: 'trick-2', trick_number: 2, led_suit: 'hearts', winner_id: null },
      ],
      handRow: { cards: [{ suit: 'hearts', value: '3' }] },
      playedByPlayer: [],
      existingTrickCards: [{ player_id: 'player-1', suit: 'hearts', value: 'A' }],
      roundBids: [
        { player_id: 'player-1', amount: 1 },
        { player_id: 'player-2', amount: 1 },
      ],
      completedTricks: [
        { winner_id: 'player-2' },
      ],
    })
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(adminMock)

    const res = await POST(makeRequest('game-id', { suit: 'hearts', value: '3' }), makeParams())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('round_complete')

    // player-1 wins trick (A beats 3), so next round's first bidder/leader must be player-1
    // Seat rotation would yield playerIds[getStartingBidderIndex(2, 2)] = playerIds[1] = 'player-2'
    // The fix should pass winnerId ('player-1') instead

    // Capture the insert argument directly from the mock chain
    // The rounds insert is called as: admin.from('rounds').insert({...}).select('id').single()
    // We need to find which .from('rounds') call led to an .insert()
    // Strategy: inspect all from('rounds') invocations and find the one whose result had .insert called
    const fromCalls = (adminMock.from as ReturnType<typeof vi.fn>).mock.calls
    const fromResults = (adminMock.from as ReturnType<typeof vi.fn>).mock.results
    let insertArg: Record<string, unknown> | null = null
    for (let i = 0; i < fromCalls.length; i++) {
      if (fromCalls[i][0] === 'rounds') {
        const result = fromResults[i].value as { insert?: ReturnType<typeof vi.fn> }
        if (result.insert && (result.insert as ReturnType<typeof vi.fn>).mock?.calls?.length > 0) {
          insertArg = (result.insert as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>
          break
        }
      }
    }

    expect(insertArg).not.toBeNull()
    expect(insertArg!.current_player_id).toBe('player-1')
    expect(insertArg!.turn_started_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })
})
