import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '../route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

function makeRequest(gameId = 'game-id') {
  return new NextRequest(`http://localhost/api/games/${gameId}/expire-turn`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  })
}

function makeParams(gameId = 'game-id') {
  return { params: Promise.resolve({ gameId }) }
}

function makeServerMock(user: { id: string } | null = { id: 'player-1' }) {
  return { auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) } }
}

// ─── Timestamp helpers ────────────────────────────────────────────────────────
// Expired: turn started 60s ago, timer is 30s → 30s past expiry
const EXPIRED_AT = new Date(Date.now() - 60_000).toISOString()
// Not expired: turn started 5s ago, timer is 30s → 25s remaining
const NOT_EXPIRED_AT = new Date(Date.now() - 5_000).toISOString()
const TURN_TIMER_SECONDS = 30

// ─── Default fixtures ─────────────────────────────────────────────────────────
const DEFAULT_GAME = { id: 'game-id', room_id: 'room-id', status: 'in_progress' }
const DEFAULT_ROOM = { turn_timer_seconds: TURN_TIMER_SECONDS }
const DEFAULT_ROOM_PLAYER = { id: 'rp-1' }

const DEFAULT_BIDDING_ROUND = {
  id: 'round-id', round_number: 1, hand_size: 10,
  status: 'bidding', current_player_id: 'player-1',
  trump_suit: 'spades', turn_started_at: EXPIRED_AT,
}

const DEFAULT_PLAYING_ROUND = {
  id: 'round-id', round_number: 1, hand_size: 2,
  status: 'playing', current_player_id: 'player-1',
  trump_suit: 'spades', turn_started_at: EXPIRED_AT,
}

const DEFAULT_PLAYERS = [
  { user_id: 'player-1', seat_order: 0 },
  { user_id: 'player-2', seat_order: 1 },
]

// Playing phase defaults:
// trick-1 complete, trick-2 active (led by player-2 with hearts:K)
const DEFAULT_TRICKS: Array<{ id: string; trick_number: number; led_suit: string | null; winner_id: string | null }> = [
  { id: 'trick-1', trick_number: 1, led_suit: 'hearts', winner_id: 'player-2' },
  { id: 'trick-2', trick_number: 2, led_suit: 'hearts', winner_id: null },
]
// player-1 hand: hearts:A and hearts:3 (in the current hand after trick-1 plays)
const DEFAULT_HAND_ROW = {
  cards: [
    { suit: 'hearts', value: 'A' },
    { suit: 'hearts', value: '3' },
  ],
}
// player-1 already played hearts:A in trick-1
const DEFAULT_PLAYED_BY_PLAYER = [{ suit: 'hearts', value: 'A' }]
// player-2 already played hearts:K in trick-2 (the led card)
const DEFAULT_EXISTING_TRICK_CARDS = [
  { player_id: 'player-2', suit: 'hearts', value: 'K' },
]

// ─── Admin mock factory ───────────────────────────────────────────────────────
function makeAdminMock({
  game = DEFAULT_GAME as typeof DEFAULT_GAME | null,
  room = DEFAULT_ROOM as { turn_timer_seconds: number | null } | null,
  roomPlayer = DEFAULT_ROOM_PLAYER as { id: string } | null,
  round = DEFAULT_BIDDING_ROUND as Record<string, unknown> | null,
  players = DEFAULT_PLAYERS,
  // Claim guard (race-condition fix)
  claimSucceeds = true,
  // Bidding phase
  existingBids = [] as Array<{ amount: number }>,
  bidsInsertError = null as unknown,
  // Playing phase
  allTricks = DEFAULT_TRICKS,
  handRow = DEFAULT_HAND_ROW as { cards: Array<{ suit: string; value: string }> } | null,
  playedByPlayer = DEFAULT_PLAYED_BY_PLAYER,
  existingTrickCards = DEFAULT_EXISTING_TRICK_CARDS,
  // Scoring path (last trick of round)
  roundBids = [] as Array<{ player_id: string; amount: number }>,
  completedTricks = [] as Array<{ winner_id: string | null }>,
} = {}) {
  // games
  const gameMaybeSingle = vi.fn().mockResolvedValue({ data: game })
  const gameEq = vi.fn().mockReturnValue({ maybeSingle: gameMaybeSingle })
  const gameSelect = vi.fn().mockReturnValue({ eq: gameEq })
  const gamesUpdateEq = vi.fn().mockResolvedValue({ error: null })
  const gamesUpdate = vi.fn().mockReturnValue({ eq: gamesUpdateEq })

  // rooms
  const roomMaybeSingle = vi.fn().mockResolvedValue({ data: room })
  const roomEq = vi.fn().mockReturnValue({ maybeSingle: roomMaybeSingle })
  const roomSelect = vi.fn().mockReturnValue({ eq: roomEq })

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

  // rounds SELECT: .select().eq('game_id').in('status').order().limit().maybeSingle()
  const roundMaybeSingle = vi.fn().mockResolvedValue({ data: round })
  const roundLimit = vi.fn().mockReturnValue({ maybeSingle: roundMaybeSingle })
  const roundOrder = vi.fn().mockReturnValue({ limit: roundLimit })
  const roundIn = vi.fn().mockReturnValue({ order: roundOrder })
  const roundEq = vi.fn().mockReturnValue({ in: roundIn })
  const roundSelect = vi.fn().mockReturnValue({ eq: roundEq })

  // rounds SELECT (prev round lookup, bid isLastBidder path): .select().eq().eq().maybeSingle()
  const prevRoundMaybeSingle = vi.fn().mockResolvedValue({ data: null })
  const prevRoundEq2 = vi.fn().mockReturnValue({ maybeSingle: prevRoundMaybeSingle })
  const prevRoundEq1 = vi.fn().mockReturnValue({ eq: prevRoundEq2 })
  const prevRoundSelect = vi.fn().mockReturnValue({ eq: prevRoundEq1 })

  // rounds UPDATE claim (atomic lock): .update().eq('id').eq('turn_started_at').select('id')
  const claimSelectId = vi.fn().mockResolvedValue({ data: claimSucceeds ? [{ id: 'round-id' }] : [] })
  const claimUpdateEq2 = vi.fn().mockReturnValue({ select: claimSelectId })
  const claimUpdateEq1 = vi.fn().mockReturnValue({ eq: claimUpdateEq2 })
  const claimUpdate = vi.fn().mockReturnValue({ eq: claimUpdateEq1 })

  // rounds UPDATE advance/transition: .update().eq()
  const roundUpdateEq = vi.fn().mockResolvedValue({ error: null })
  const roundUpdate = vi.fn().mockReturnValue({ eq: roundUpdateEq })

  // rounds INSERT (next round dealing): .insert().select().single()
  const roundInsertSingle = vi.fn().mockResolvedValue({ data: { id: 'next-round-id' }, error: null })
  const roundInsertSelect = vi.fn().mockReturnValue({ single: roundInsertSingle })
  const roundInsert = vi.fn().mockReturnValue({ select: roundInsertSelect })

  // bids SELECT: .select().eq()
  const bidsSelectEq = vi.fn().mockResolvedValue({ data: existingBids })
  const bidsSelect = vi.fn().mockReturnValue({ eq: bidsSelectEq })

  // bids INSERT
  const bidsInsert = vi.fn().mockResolvedValue({ error: bidsInsertError })

  // tricks first SELECT: all tricks for round .select().eq().order()
  const tricksSelectOrder = vi.fn().mockResolvedValue({ data: allTricks })
  const tricksSelectEq = vi.fn().mockReturnValue({ order: tricksSelectOrder })
  const tricksAllSelect = vi.fn().mockReturnValue({ eq: tricksSelectEq })

  // tricks second SELECT (scoring): completed tricks .select().eq().not()
  const tricksCompletedNot = vi.fn().mockResolvedValue({ data: completedTricks })
  const tricksCompletedEq = vi.fn().mockReturnValue({ not: tricksCompletedNot })
  const tricksCompletedSelect = vi.fn().mockReturnValue({ eq: tricksCompletedEq })

  // tricks last-winner SELECT (bid last-bidder path): .select().eq().not().order().limit().maybeSingle()
  const lastTrickMaybeSingle = vi.fn().mockResolvedValue({ data: null })
  const lastTrickLimit = vi.fn().mockReturnValue({ maybeSingle: lastTrickMaybeSingle })
  const lastTrickOrder = vi.fn().mockReturnValue({ limit: lastTrickLimit })
  const lastTrickNot = vi.fn().mockReturnValue({ order: lastTrickOrder })
  const lastTrickEq = vi.fn().mockReturnValue({ not: lastTrickNot })
  const lastTrickSelect = vi.fn().mockReturnValue({ eq: lastTrickEq })

  // tricks UPDATE and INSERT
  const tricksUpdateEq = vi.fn().mockResolvedValue({ error: null })
  const tricksUpdate = vi.fn().mockReturnValue({ eq: tricksUpdateEq })
  const tricksInsert = vi.fn().mockResolvedValue({ error: null })

  // hands SELECT: .select().eq().eq().maybeSingle()
  const handsMaybeSingle = vi.fn().mockResolvedValue({ data: handRow })
  const handsEq2 = vi.fn().mockReturnValue({ maybeSingle: handsMaybeSingle })
  const handsEq1 = vi.fn().mockReturnValue({ eq: handsEq2 })
  const handsSelect = vi.fn().mockReturnValue({ eq: handsEq1 })
  const handsInsert = vi.fn().mockResolvedValue({ error: null })

  // trick_cards SELECT played-by-player: .select().eq('player_id').in('trick_id')
  const tcPlayedIn = vi.fn().mockResolvedValue({ data: playedByPlayer })
  const tcPlayedEq = vi.fn().mockReturnValue({ in: tcPlayedIn })
  const tcPlayedSelect = vi.fn().mockReturnValue({ eq: tcPlayedEq })

  // trick_cards SELECT existing in current trick: .select().eq('trick_id')
  const tcExistingEq = vi.fn().mockResolvedValue({ data: existingTrickCards })
  const tcExistingSelect = vi.fn().mockReturnValue({ eq: tcExistingEq })

  // trick_cards INSERT
  const tcInsert = vi.fn().mockResolvedValue({ error: null })

  // round_scores INSERT and SELECT
  const rsInsert = vi.fn().mockResolvedValue({ error: null })
  const rsSelectIn = vi.fn().mockResolvedValue({ data: [] })
  const rsSelect = vi.fn().mockReturnValue({ in: rsSelectIn })

  // game_results INSERT
  const gameResultsInsert = vi.fn().mockResolvedValue({ error: null })

  // rounds SELECT all IDs (game completion)
  const allRoundsEq = vi.fn().mockResolvedValue({ data: [] })
  const allRoundsSelect = vi.fn().mockReturnValue({ eq: allRoundsEq })

  let rpCallCount = 0
  let roundsCallCount = 0
  let tricksCallCount = 0
  let tcSelectCallCount = 0

  const fromMock = vi.fn().mockImplementation((table: string) => {
    if (table === 'games') return { select: gameSelect, update: gamesUpdate }
    if (table === 'rooms') return { select: roomSelect }
    if (table === 'room_players') {
      const idx = rpCallCount++
      if (idx === 0) return { select: rpMemberSelect }
      return { select: rpListSelect }
    }
    if (table === 'rounds') {
      const idx = roundsCallCount++
      if (idx === 0) return { select: roundSelect }
      // Call 1: atomic claim UPDATE (always after the initial SELECT)
      if (idx === 1) return { update: claimUpdate }
      // Call 2: prev round SELECT (bid last-bidder path) or advance UPDATE (other paths)
      // Call 3+: all round IDs for scoring/game-completion
      if (idx === 2) return { select: prevRoundSelect, update: roundUpdate, insert: roundInsert }
      return { select: allRoundsSelect, update: roundUpdate, insert: roundInsert }
    }
    if (table === 'bids') return { select: bidsSelect, insert: bidsInsert }
    if (table === 'tricks') {
      const idx = tricksCallCount++
      if (idx === 0) return { select: tricksAllSelect, update: tricksUpdate, insert: tricksInsert }
      // Call 1: last-winner lookup (bid last-bidder) OR completed tricks (scoring)
      if (idx === 1) return { select: lastTrickSelect, update: tricksUpdate, insert: tricksInsert }
      return { select: tricksCompletedSelect, update: tricksUpdate, insert: tricksInsert }
    }
    if (table === 'hands') return { select: handsSelect, insert: handsInsert }
    if (table === 'trick_cards') {
      const idx = tcSelectCallCount++
      if (idx === 0) return { select: tcPlayedSelect }
      if (idx === 1) return { select: tcExistingSelect }
      return { insert: tcInsert }
    }
    if (table === 'round_scores') return { insert: rsInsert, select: rsSelect }
    if (table === 'game_results') return { insert: gameResultsInsert }
    throw new Error(`Unexpected table: ${table}`)
  })

  return { from: fromMock, tricksUpdate, roundUpdate, claimUpdate, bidsInsert, tcInsert }
}

beforeEach(() => {
  vi.resetAllMocks()
})

// ─── Tests ─────────────────────────────────────────────────────────────────────
describe('POST /api/games/[gameId]/expire-turn', () => {
  // ── Guard tests ─────────────────────────────────────────────────────────────
  it('returns 401 when unauthenticated', async () => {
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock(null))
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(makeAdminMock())
    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(401)
  })

  it('returns 404 when game is not found', async () => {
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock())
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(makeAdminMock({ game: null }))
    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(404)
  })

  it('returns 403 when user is not an active player in the room', async () => {
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock())
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(
      makeAdminMock({ roomPlayer: null })
    )
    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(403)
  })

  it('returns 422 when there is no active bidding or playing round', async () => {
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock())
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(
      makeAdminMock({ round: null })
    )
    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(422)
  })

  // ── Timer check ─────────────────────────────────────────────────────────────
  it('returns { status: not_expired } when timer has not yet elapsed', async () => {
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock())
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(
      makeAdminMock({
        round: { ...DEFAULT_BIDDING_ROUND, turn_started_at: NOT_EXPIRED_AT },
      })
    )
    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('not_expired')
  })

  // ── Race condition guard ─────────────────────────────────────────────────────
  it('returns { status: already_resolved } when a concurrent request already claimed the turn', async () => {
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock())
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(
      makeAdminMock({ claimSucceeds: false })
    )
    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('already_resolved')
  })

  // ── Bidding phase auto-resolution ───────────────────────────────────────────
  it('auto-bids 0 (lowest valid) and advances turn when bidding phase timer expires (non-last bidder)', async () => {
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock())
    const admin = makeAdminMock({
      round: DEFAULT_BIDDING_ROUND, // current_player_id: player-1, turn_started_at: EXPIRED
      existingBids: [],             // player-1 is first of 2 → not last bidder
    })
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(admin)

    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('bidding')

    // bid inserted with amount=0 (lowest valid) for the current player
    expect(admin.bidsInsert).toHaveBeenCalledWith(
      expect.objectContaining({ player_id: 'player-1', amount: 0 })
    )

    // round updated to advance to player-2 with a new turn_started_at
    const updateArg = (admin.roundUpdate as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>
    expect(updateArg.current_player_id).toBe('player-2')
    expect(updateArg.turn_started_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })

  it('auto-bids lowest valid bid (skipping forbidden) for last bidder and transitions to playing', async () => {
    // player-2 is last bidder; player-1 already bid 10 → forbidden = hand_size(10) - 10 = 0
    // so valid bids = [1..10]; lowest valid = 1
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock({ id: 'player-2' }))
    const admin = makeAdminMock({
      round: { ...DEFAULT_BIDDING_ROUND, current_player_id: 'player-2' },
      existingBids: [{ amount: 10 }], // player-1 bid 10, forbidden = 0
    })
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(admin)

    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('playing')

    // amount must NOT be 0 (forbidden), must be 1 (the new lowest valid)
    expect(admin.bidsInsert).toHaveBeenCalledWith(
      expect.objectContaining({ player_id: 'player-2', amount: 1 })
    )
  })

  // ── Playing phase auto-resolution ───────────────────────────────────────────
  it('auto-plays lowest card of lead suit when player can follow suit', async () => {
    // player-1 hand (after played cards removed): hearts:A and hearts:3
    // Trick-2 led suit: hearts (player-2 played hearts:K)
    // Must follow suit → pick lowest hearts → hearts:3 (rank 3 < rank 14)
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock())
    const admin = makeAdminMock({
      round: DEFAULT_PLAYING_ROUND,  // current_player_id: player-1
      allTricks: DEFAULT_TRICKS,     // trick-2 is active, led_suit: 'hearts'
      handRow: DEFAULT_HAND_ROW,     // hearts:A, hearts:3
      playedByPlayer: DEFAULT_PLAYED_BY_PLAYER, // hearts:A already played
      existingTrickCards: DEFAULT_EXISTING_TRICK_CARDS, // player-2 played hearts:K
    })
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(admin)

    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(200)

    // trick_card inserted with hearts:3 (lowest card following suit)
    expect(admin.tcInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        player_id: 'player-1',
        suit: 'hearts',
        value: '3',
      })
    )
  })

  it('auto-plays lowest card overall when player cannot follow lead suit', async () => {
    // player-1 hand: spades:A and spades:3 — no hearts
    // Trick-2 led suit: hearts — player-1 cannot follow
    // Must pick lowest overall → spades:3 (rank 3 < rank 14)
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock())
    const admin = makeAdminMock({
      round: DEFAULT_PLAYING_ROUND,
      allTricks: DEFAULT_TRICKS,
      handRow: { cards: [{ suit: 'spades', value: 'A' }, { suit: 'spades', value: '3' }] },
      playedByPlayer: [],                       // nothing played yet (first trick is active)
      existingTrickCards: DEFAULT_EXISTING_TRICK_CARDS, // led suit: hearts
    })
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(admin)

    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(200)

    expect(admin.tcInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        player_id: 'player-1',
        suit: 'spades',
        value: '3',
      })
    )
  })

  it('auto-plays lowest card overall when leading a trick (no led suit yet)', async () => {
    // player-1 is the leader of trick-2 (no cards played yet in it)
    // Hand: hearts:A and clubs:2 — lowest overall is clubs:2 (rank 2)
    const tricksWithEmptyActiveTrick = [
      { id: 'trick-1', trick_number: 1, led_suit: 'hearts', winner_id: 'player-2' },
      { id: 'trick-2', trick_number: 2, led_suit: null, winner_id: null },
    ]
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(makeServerMock())
    const admin = makeAdminMock({
      round: DEFAULT_PLAYING_ROUND,
      allTricks: tricksWithEmptyActiveTrick,
      handRow: { cards: [{ suit: 'hearts', value: 'A' }, { suit: 'clubs', value: '2' }] },
      playedByPlayer: [{ suit: 'hearts', value: 'K' }], // played in trick-1
      existingTrickCards: [],  // no cards in trick-2 yet (player-1 is leading)
    })
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(admin)

    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(200)

    expect(admin.tcInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        player_id: 'player-1',
        suit: 'clubs',
        value: '2',
      })
    )
  })
})
