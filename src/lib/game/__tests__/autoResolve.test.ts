import { describe, it, expect, vi, beforeEach } from 'vitest'
import { autoResolveBid, autoResolvePlay, pickLowestLegalCard, resolveDroppedTurnChain } from '../autoResolve'
import type { Card } from '../types'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

// ─── Shared fixtures ───────────────────────────────────────────────────────────

const DEFAULT_ROUND = {
  id: 'round-1',
  round_number: 1,
  hand_size: 3,
  current_player_id: 'player-1',
  trump_suit: 'spades',
}

const TWO_PLAYERS = [
  { user_id: 'player-1', seat_order: 0, status: 'active' },
  { user_id: 'player-2', seat_order: 1, status: 'active' },
]

const THREE_PLAYERS = [
  { user_id: 'player-1', seat_order: 0, status: 'active' },
  { user_id: 'player-2', seat_order: 1, status: 'active' },
  { user_id: 'player-3', seat_order: 2, status: 'active' },
]

// ─── Admin mock helpers ────────────────────────────────────────────────────────
// Each mock fn must be callable and return a resolved Promise (or an object
// with further chainable methods). The key rule:
//   - If the code `await`s the return of a method, that method must be a
//     `vi.fn().mockResolvedValue(...)` (calling it returns a Promise).
//   - If the code chains further (e.g. `.select().eq().maybeSingle()`), each
//     intermediate method must return an object with the next method.

// ─── autoResolveBid mock ──────────────────────────────────────────────────────

function makeBidAdminMock({
  handRows = [{ player_id: 'player-1' }, { player_id: 'player-2' }],
  players = TWO_PLAYERS,
  existingBids = [] as Array<{ amount: number }>,
  bidsInsertError = null as unknown,
  prevRoundData = null as { id: string } | null,
  lastTrickData = null as { winner_id: string } | null,
  nextRoundId = 'next-round-id',
} = {}) {
  // hands SELECT: .select('player_id').eq('round_id', ...) → { data }
  const handsSelectEq = vi.fn().mockResolvedValue({ data: handRows })
  const handsSelect = vi.fn().mockReturnValue({ eq: handsSelectEq })
  const handsInsert = vi.fn().mockResolvedValue({ error: null })

  // room_players SELECT: .select().eq('room_id').in('user_id').order() → { data }
  const rpOrder = vi.fn().mockResolvedValue({ data: players })
  const rpIn = vi.fn().mockReturnValue({ order: rpOrder })
  const rpEq = vi.fn().mockReturnValue({ in: rpIn })
  const rpSelect = vi.fn().mockReturnValue({ eq: rpEq })

  // bids SELECT: .select('amount').eq('round_id') → { data }
  const bidsSelectEq = vi.fn().mockResolvedValue({ data: existingBids })
  const bidsSelect = vi.fn().mockReturnValue({ eq: bidsSelectEq })
  const bidsInsert = vi.fn().mockResolvedValue({ error: bidsInsertError })

  // rounds SELECT prev round: .select('id').eq('game_id').eq('round_number').maybeSingle()
  const prevRoundMaybeSingle = vi.fn().mockResolvedValue({ data: prevRoundData })
  const prevRoundEq2 = vi.fn().mockReturnValue({ maybeSingle: prevRoundMaybeSingle })
  const prevRoundEq1 = vi.fn().mockReturnValue({ eq: prevRoundEq2 })
  const prevRoundSelect = vi.fn().mockReturnValue({ eq: prevRoundEq1 })

  // rounds UPDATE: .update({}).eq() → resolves
  const roundUpdateEq = vi.fn().mockResolvedValue({ error: null })
  const roundUpdate = vi.fn().mockReturnValue({ eq: roundUpdateEq })

  // rounds INSERT (next round): .insert({}).select('id').single()
  const roundInsertSingle = vi.fn().mockResolvedValue({ data: { id: nextRoundId }, error: null })
  const roundInsertSelect = vi.fn().mockReturnValue({ single: roundInsertSingle })
  const roundInsert = vi.fn().mockReturnValue({ select: roundInsertSelect })

  // tricks SELECT last winner: .select('winner_id').eq().not().order().limit().maybeSingle()
  const lastTrickMaybeSingle = vi.fn().mockResolvedValue({ data: lastTrickData })
  const lastTrickLimit = vi.fn().mockReturnValue({ maybeSingle: lastTrickMaybeSingle })
  const lastTrickOrder = vi.fn().mockReturnValue({ limit: lastTrickLimit })
  const lastTrickNot = vi.fn().mockReturnValue({ order: lastTrickOrder })
  const lastTrickEq = vi.fn().mockReturnValue({ not: lastTrickNot })
  const lastTrickSelect = vi.fn().mockReturnValue({ eq: lastTrickEq })

  // tricks INSERT: .insert({}) → resolves
  const tricksInsert = vi.fn().mockResolvedValue({ error: null })

  let roundsCallCount = 0
  let tricksCallCount = 0

  const fromMock = vi.fn().mockImplementation((table: string) => {
    if (table === 'hands') return { select: handsSelect, insert: handsInsert }
    if (table === 'room_players') return { select: rpSelect }
    if (table === 'bids') return { select: bidsSelect, insert: bidsInsert }
    if (table === 'rounds') {
      const idx = roundsCallCount++
      // Call 0: prev round SELECT (only on isLastBidder path) OR UPDATE advance
      // Call 1+: further SELECT/UPDATE calls
      if (idx === 0) return { select: prevRoundSelect, update: roundUpdate, insert: roundInsert }
      return { select: prevRoundSelect, update: roundUpdate, insert: roundInsert }
    }
    if (table === 'tricks') {
      const idx = tricksCallCount++
      if (idx === 0) return { select: lastTrickSelect, insert: tricksInsert }
      return { insert: tricksInsert }
    }
    throw new Error(`Unexpected table in bid mock: ${table}`)
  })

  return { from: fromMock, bidsInsert, roundUpdate, tricksInsert, handsInsert }
}

// ─── autoResolvePlay mock ─────────────────────────────────────────────────────

function makePlayAdminMock({
  handRows = [{ player_id: 'player-1' }, { player_id: 'player-2' }],
  players = TWO_PLAYERS,
  allTricks = [
    { id: 'trick-1', trick_number: 1, led_suit: 'hearts', winner_id: 'player-2' },
    { id: 'trick-2', trick_number: 2, led_suit: 'hearts', winner_id: null },
  ] as Array<{ id: string; trick_number: number; led_suit: string | null; winner_id: string | null }>,
  handRowCards = [{ suit: 'hearts', value: '3' }, { suit: 'hearts', value: 'A' }] as Array<{ suit: string; value: string }> | null,
  playedByPlayer = [] as Array<{ suit: string; value: string }>,
  existingTrickCards = [{ player_id: 'player-2', suit: 'hearts', value: 'K' }] as Array<{ player_id: string; suit: string; value: string }>,
  tcInsertError = null as unknown,
  handsInsertError = null as unknown,
  roundBids = [] as Array<{ player_id: string; amount: number }>,
  completedTricks = [] as Array<{ winner_id: string | null }>,
  allRoundScores = [] as Array<{ player_id: string; score: number }>,
  nextRoundId = 'next-round-id',
} = {}) {
  // hands SELECT player_id list: .select('player_id').eq('round_id') → { data }
  const handsListEq = vi.fn().mockResolvedValue({ data: handRows })
  const handsListSelect = vi.fn().mockReturnValue({ eq: handsListEq })

  // hands SELECT cards: .select('cards').eq('round_id').eq('player_id').maybeSingle()
  const handsMaybeSingle = vi.fn().mockResolvedValue({ data: handRowCards === null ? null : { cards: handRowCards } })
  const handsCardsEq2 = vi.fn().mockReturnValue({ maybeSingle: handsMaybeSingle })
  const handsCardsEq1 = vi.fn().mockReturnValue({ eq: handsCardsEq2 })
  const handsCardsSelect = vi.fn().mockReturnValue({ eq: handsCardsEq1 })

  // hands INSERT (for next round)
  const handsInsert = vi.fn().mockResolvedValue({ error: handsInsertError })

  // room_players SELECT: .select().eq('room_id').in('user_id').order() → { data }
  const rpOrder = vi.fn().mockResolvedValue({ data: players })
  const rpIn = vi.fn().mockReturnValue({ order: rpOrder })
  const rpEq = vi.fn().mockReturnValue({ in: rpIn })
  const rpSelect = vi.fn().mockReturnValue({ eq: rpEq })

  // tricks SELECT all: .select(...).eq('round_id').order() → { data }
  const tricksAllOrder = vi.fn().mockResolvedValue({ data: allTricks })
  const tricksAllEq = vi.fn().mockReturnValue({ order: tricksAllOrder })
  const tricksAllSelect = vi.fn().mockReturnValue({ eq: tricksAllEq })

  // tricks SELECT completed: .select('winner_id').eq('round_id').not() → { data }
  const tricksCompletedNot = vi.fn().mockResolvedValue({ data: completedTricks })
  const tricksCompletedEq = vi.fn().mockReturnValue({ not: tricksCompletedNot })
  const tricksCompletedSelect = vi.fn().mockReturnValue({ eq: tricksCompletedEq })

  // tricks UPDATE: .update({}).eq() → resolves
  const tricksUpdateEq = vi.fn().mockResolvedValue({ error: null })
  const tricksUpdate = vi.fn().mockReturnValue({ eq: tricksUpdateEq })

  // tricks INSERT: .insert({}) → resolves
  const tricksInsert = vi.fn().mockResolvedValue({ error: null })

  // trick_cards SELECT played-by-player: .select('suit, value').eq('player_id').in('trick_id') → { data }
  const tcPlayedIn = vi.fn().mockResolvedValue({ data: playedByPlayer })
  const tcPlayedEq = vi.fn().mockReturnValue({ in: tcPlayedIn })
  const tcPlayedSelect = vi.fn().mockReturnValue({ eq: tcPlayedEq })

  // trick_cards SELECT existing: .select('player_id, suit, value').eq('trick_id') → { data }
  const tcExistingEq = vi.fn().mockResolvedValue({ data: existingTrickCards })
  const tcExistingSelect = vi.fn().mockReturnValue({ eq: tcExistingEq })

  // trick_cards INSERT: .insert({}) → resolves
  const tcInsert = vi.fn().mockResolvedValue({ error: tcInsertError })

  // bids SELECT: .select('player_id, amount').eq('round_id') → { data }
  const bidsSelectEq = vi.fn().mockResolvedValue({ data: roundBids })
  const bidsSelect = vi.fn().mockReturnValue({ eq: bidsSelectEq })

  // rounds UPDATE: .update({}).eq() → resolves
  const roundUpdateEq = vi.fn().mockResolvedValue({ error: null })
  const roundUpdate = vi.fn().mockReturnValue({ eq: roundUpdateEq })

  // rounds SELECT all IDs: .select('id').eq('game_id') → { data }
  const allRoundsEq = vi.fn().mockResolvedValue({ data: [{ id: 'round-1' }] })
  const allRoundsSelect = vi.fn().mockReturnValue({ eq: allRoundsEq })

  // rounds INSERT next round: .insert({}).select('id').single()
  const roundInsertSingle = vi.fn().mockResolvedValue({ data: { id: nextRoundId }, error: null })
  const roundInsertSelect = vi.fn().mockReturnValue({ single: roundInsertSingle })
  const roundInsert = vi.fn().mockReturnValue({ select: roundInsertSelect })

  // round_scores INSERT & SELECT
  const rsInsert = vi.fn().mockResolvedValue({ error: null })
  const rsSelectIn = vi.fn().mockResolvedValue({ data: allRoundScores })
  const rsSelect = vi.fn().mockReturnValue({ in: rsSelectIn })

  // game_results INSERT
  const gameResultsInsert = vi.fn().mockResolvedValue({ error: null })

  // games UPDATE: .update({}).eq() → resolves
  const gamesUpdateEq = vi.fn().mockResolvedValue({ error: null })
  const gamesUpdate = vi.fn().mockReturnValue({ eq: gamesUpdateEq })

  let handsCallCount = 0
  let tricksCallCount = 0
  let tcSelectCallCount = 0
  let roundsCallCount = 0

  const fromMock = vi.fn().mockImplementation((table: string) => {
    if (table === 'games') return { update: gamesUpdate }
    if (table === 'hands') {
      const idx = handsCallCount++
      if (idx === 0) return { select: handsListSelect }       // player_id list
      if (idx === 1) return { select: handsCardsSelect }      // cards lookup
      return { insert: handsInsert }                          // next round insert
    }
    if (table === 'room_players') return { select: rpSelect }
    if (table === 'tricks') {
      const idx = tricksCallCount++
      if (idx === 0) return { select: tricksAllSelect, update: tricksUpdate, insert: tricksInsert }
      // idx=1 could be tricks UPDATE (winner_id or led_suit) or completed tricks SELECT
      // idx=2 could be tricks UPDATE or completed tricks SELECT
      // Provide all operations at every index; call count routing is handled by the function's own logic
      if (idx === 1) return { select: tricksCompletedSelect, update: tricksUpdate, insert: tricksInsert }
      return { select: tricksCompletedSelect, update: tricksUpdate, insert: tricksInsert }
    }
    if (table === 'trick_cards') {
      const idx = tcSelectCallCount++
      if (idx === 0) return { select: tcPlayedSelect }
      if (idx === 1) return { select: tcExistingSelect }
      return { insert: tcInsert }
    }
    if (table === 'bids') return { select: bidsSelect }
    if (table === 'rounds') {
      const idx = roundsCallCount++
      if (idx === 0) return { update: roundUpdate, select: allRoundsSelect, insert: roundInsert }
      return { update: roundUpdate, select: allRoundsSelect, insert: roundInsert }
    }
    if (table === 'round_scores') return { insert: rsInsert, select: rsSelect }
    if (table === 'game_results') return { insert: gameResultsInsert }
    throw new Error(`Unexpected table in play mock: ${table}`)
  })

  return { from: fromMock, tcInsert, handsInsert, roundUpdate, tricksUpdate, tricksInsert, rsInsert, gameResultsInsert }
}

beforeEach(() => {
  vi.resetAllMocks()
})

// ─── pickLowestLegalCard ──────────────────────────────────────────────────────

describe('pickLowestLegalCard', () => {
  it('picks lowest ranked card of lead suit when player can follow', () => {
    const hand: Card[] = [
      { suit: 'hearts', value: 'A' },
      { suit: 'hearts', value: '3' },
      { suit: 'spades', value: '2' },
    ]
    const result = pickLowestLegalCard(hand, 'hearts')
    expect(result).toEqual({ suit: 'hearts', value: '3' })
  })

  it('picks lowest card overall when player cannot follow suit', () => {
    const hand: Card[] = [
      { suit: 'spades', value: 'A' },
      { suit: 'clubs', value: '2' },
    ]
    const result = pickLowestLegalCard(hand, 'hearts')
    expect(result).toEqual({ suit: 'clubs', value: '2' })
  })

  it('picks lowest card overall when no lead suit (leading the trick)', () => {
    const hand: Card[] = [
      { suit: 'spades', value: 'K' },
      { suit: 'clubs', value: '2' },
    ]
    const result = pickLowestLegalCard(hand, null)
    expect(result).toEqual({ suit: 'clubs', value: '2' })
  })
})

// ─── autoResolveBid ───────────────────────────────────────────────────────────

describe('autoResolveBid', () => {
  it('inserts auto-bid of 0 and advances to next player when not last bidder', async () => {
    const admin = makeBidAdminMock({ existingBids: [] })
    const result = await autoResolveBid(admin as unknown as ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>, 'game-1', 'room-1', DEFAULT_ROUND)

    expect(result).toEqual({ ok: true, status: 'bidding' })
    expect(admin.bidsInsert).toHaveBeenCalledWith(
      expect.objectContaining({ player_id: 'player-1', amount: 0 })
    )
    const updateArg = (admin.roundUpdate as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>
    expect(updateArg.current_player_id).toBe('player-2')
    expect(typeof updateArg.turn_started_at).toBe('string')
  })

  it('returns error when no players found', async () => {
    const admin = makeBidAdminMock({ handRows: [] })
    const result = await autoResolveBid(admin as unknown as ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>, 'game-1', 'room-1', DEFAULT_ROUND)

    expect(result).toEqual({ ok: false, error: 'No players found', httpStatus: 500 })
  })

  it('returns error when bid insert fails', async () => {
    const admin = makeBidAdminMock({ bidsInsertError: { message: 'DB error' } })
    const result = await autoResolveBid(admin as unknown as ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>, 'game-1', 'room-1', DEFAULT_ROUND)

    expect(result).toEqual({ ok: false, error: 'Failed to record auto-bid', httpStatus: 500 })
  })

  it('transitions to playing when last bidder submits (round 1)', async () => {
    const admin = makeBidAdminMock({
      existingBids: [{ amount: 1 }], // 1 existing bid → player-2 is last of 2
    })
    const round = { ...DEFAULT_ROUND, current_player_id: 'player-2' }
    const result = await autoResolveBid(admin as unknown as ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>, 'game-1', 'room-1', round)

    expect(result).toEqual({ ok: true, status: 'playing' })
    const updateArg = (admin.roundUpdate as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>
    expect(updateArg.status).toBe('playing')
    expect(admin.tricksInsert).toHaveBeenCalled()
  })

  it('uses round hands-based player list (not just active players)', async () => {
    // A dropped player is in the hand but status !== 'active'
    const playersWithDropped = [
      { user_id: 'player-1', seat_order: 0, status: 'active' },
      { user_id: 'player-2', seat_order: 1, status: 'dropped' },
      { user_id: 'player-3', seat_order: 2, status: 'active' },
    ]
    const admin = makeBidAdminMock({
      handRows: [{ player_id: 'player-1' }, { player_id: 'player-2' }, { player_id: 'player-3' }],
      players: playersWithDropped,
      existingBids: [], // player-1 is first of 3 → not last bidder
    })
    const result = await autoResolveBid(admin as unknown as ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>, 'game-1', 'room-1', DEFAULT_ROUND)

    expect(result).toEqual({ ok: true, status: 'bidding' })
    // Advances to player-2 regardless of dropped status (chain handles consecutive drops)
    const updateArg = (admin.roundUpdate as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>
    expect(updateArg.current_player_id).toBe('player-2')
  })

  it('correctly triggers isLastBidder when dropped player bid is already in DB', async () => {
    // Invariant: resolveDroppedTurnChain auto-inserts a bid for dropped players before
    // advancing the turn to the next active player. So when autoResolveBid runs for
    // player-3 (the last active bidder), player-2's auto-bid is ALREADY in existingBids.
    // existingAmounts.length = 2 === players.length - 1 (3-1=2) → isLastBidder = true → playing.
    const playersWithDropped = [
      { user_id: 'player-1', seat_order: 0, status: 'active' },
      { user_id: 'player-2', seat_order: 1, status: 'dropped' },
      { user_id: 'player-3', seat_order: 2, status: 'active' },
    ]
    const admin = makeBidAdminMock({
      handRows: [{ player_id: 'player-1' }, { player_id: 'player-2' }, { player_id: 'player-3' }],
      players: playersWithDropped,
      existingBids: [{ amount: 1 }, { amount: 0 }], // player-1 bid + player-2 auto-bid already inserted
    })
    const round = { ...DEFAULT_ROUND, current_player_id: 'player-3', round_number: 1 }
    const result = await autoResolveBid(admin as unknown as ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>, 'game-1', 'room-1', round)

    expect(result).toEqual({ ok: true, status: 'playing' })
  })

  it('uses non-dropped players as eligible leaders when transitioning to playing', async () => {
    const playersWithDropped = [
      { user_id: 'player-1', seat_order: 0, status: 'active' },
      { user_id: 'player-2', seat_order: 1, status: 'dropped' }, // dropped → not eligible leader
      { user_id: 'player-3', seat_order: 2, status: 'active' },
    ]
    const admin = makeBidAdminMock({
      handRows: [{ player_id: 'player-1' }, { player_id: 'player-2' }, { player_id: 'player-3' }],
      players: playersWithDropped,
      // player-1 bid + player-2 auto-bid already in DB → player-3 is the last of players.length=3
      existingBids: [{ amount: 0 }, { amount: 0 }],
    })
    const round = { ...DEFAULT_ROUND, current_player_id: 'player-3', round_number: 1 }
    const result = await autoResolveBid(admin as unknown as ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>, 'game-1', 'room-1', round)

    expect(result).toEqual({ ok: true, status: 'playing' })
    const updateArg = (admin.roundUpdate as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>
    // Leading player must not be 'player-2' (dropped)
    expect(updateArg.current_player_id).not.toBe('player-2')
  })
})

// ─── autoResolvePlay ──────────────────────────────────────────────────────────

describe('autoResolvePlay', () => {
  const PLAYING_ROUND = {
    id: 'round-1',
    round_number: 1,
    hand_size: 2,
    current_player_id: 'player-1',
    trump_suit: 'spades',
  }

  it('auto-plays lowest card of lead suit when trick is in progress', async () => {
    // trick-2 active, led_suit: hearts, player-2 played K, player-1 must follow suit
    // player-1 hand (after A removed from trick-1): only hearts:3 remains
    const admin = makePlayAdminMock({
      allTricks: [
        { id: 'trick-1', trick_number: 1, led_suit: 'hearts', winner_id: 'player-2' },
        { id: 'trick-2', trick_number: 2, led_suit: 'hearts', winner_id: null },
      ],
      handRowCards: [{ suit: 'hearts', value: 'A' }, { suit: 'hearts', value: '3' }],
      playedByPlayer: [{ suit: 'hearts', value: 'A' }], // already played in trick-1
      existingTrickCards: [{ player_id: 'player-2', suit: 'hearts', value: 'K' }],
    })

    const result = await autoResolvePlay(admin as unknown as ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>, 'game-1', 'room-1', PLAYING_ROUND)

    // 2 players, 2 cards played → trick complete (trick-2 is last of hand_size=2)
    expect(result.ok).toBe(true)
    expect(admin.tcInsert).toHaveBeenCalledWith(
      expect.objectContaining({ player_id: 'player-1', suit: 'hearts', value: '3' })
    )
  })

  it('returns error when no active trick', async () => {
    const admin = makePlayAdminMock({
      allTricks: [
        { id: 'trick-1', trick_number: 1, led_suit: 'hearts', winner_id: 'player-2' },
        // No active trick
      ],
    })

    const result = await autoResolvePlay(admin as unknown as ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>, 'game-1', 'room-1', PLAYING_ROUND)
    expect(result).toEqual({ ok: false, error: 'No active trick', httpStatus: 422 })
  })

  it('returns error when hand not found', async () => {
    const admin = makePlayAdminMock({ handRowCards: null })
    const result = await autoResolvePlay(admin as unknown as ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>, 'game-1', 'room-1', PLAYING_ROUND)
    expect(result).toEqual({ ok: false, error: 'Hand not found', httpStatus: 500 })
  })

  it('returns error when trick_card insert fails', async () => {
    const admin = makePlayAdminMock({ tcInsertError: { message: 'DB error' } })
    const result = await autoResolvePlay(admin as unknown as ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>, 'game-1', 'room-1', PLAYING_ROUND)
    expect(result).toEqual({ ok: false, error: 'Failed to record auto-play', httpStatus: 500 })
  })

  it('advances to next player when trick is still in progress', async () => {
    // 3 players, trick-1 is active, 1 card already played (player-2), player-1 plays → 2 of 3 played
    const admin = makePlayAdminMock({
      handRows: [{ player_id: 'player-1' }, { player_id: 'player-2' }, { player_id: 'player-3' }],
      players: THREE_PLAYERS,
      allTricks: [
        { id: 'trick-1', trick_number: 1, led_suit: 'hearts', winner_id: null },
      ],
      handRowCards: [{ suit: 'clubs', value: '2' }],
      playedByPlayer: [],
      existingTrickCards: [
        { player_id: 'player-2', suit: 'hearts', value: 'K' },
      ], // 1 existing + player-1 plays = 2 < 3 players
    })
    const round = { ...PLAYING_ROUND, hand_size: 3 }
    const result = await autoResolvePlay(admin as unknown as ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>, 'game-1', 'room-1', round)

    expect(result).toEqual({ ok: true, status: 'trick_in_progress' })
    const updateArg = (admin.roundUpdate as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>
    expect(updateArg.current_player_id).toBe('player-2')
  })

  it('scores the round and starts next round when last trick completes (not last round)', async () => {
    // hand_size=2, trick-2 is last. Both players played → trick complete → round scored
    const admin = makePlayAdminMock({
      allTricks: [
        { id: 'trick-1', trick_number: 1, led_suit: 'spades', winner_id: 'player-2' },
        { id: 'trick-2', trick_number: 2, led_suit: 'spades', winner_id: null },
      ],
      handRowCards: [{ suit: 'spades', value: '2' }],
      playedByPlayer: [{ suit: 'spades', value: 'K' }],
      existingTrickCards: [{ player_id: 'player-2', suit: 'spades', value: '3' }],
      roundBids: [
        { player_id: 'player-1', amount: 1 },
        { player_id: 'player-2', amount: 1 },
      ],
      completedTricks: [
        { winner_id: 'player-2' }, // trick-1 winner
      ],
    })
    const round = { ...PLAYING_ROUND, hand_size: 2, round_number: 1 }

    const result = await autoResolvePlay(admin as unknown as ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>, 'game-1', 'room-1', round)

    expect(result.ok).toBe(true)
    expect((result as { ok: true; status: string }).status).toBe('round_complete')
    expect(admin.rsInsert).toHaveBeenCalled()
  })

  it('returns ok:false when hands insert fails on next round', async () => {
    const admin = makePlayAdminMock({
      allTricks: [
        { id: 'trick-1', trick_number: 1, led_suit: 'spades', winner_id: 'player-2' },
        { id: 'trick-2', trick_number: 2, led_suit: 'spades', winner_id: null },
      ],
      handRowCards: [{ suit: 'spades', value: '2' }],
      playedByPlayer: [{ suit: 'spades', value: 'K' }],
      existingTrickCards: [{ player_id: 'player-2', suit: 'spades', value: '3' }],
      roundBids: [
        { player_id: 'player-1', amount: 1 },
        { player_id: 'player-2', amount: 1 },
      ],
      completedTricks: [{ winner_id: 'player-2' }],
      handsInsertError: { message: 'DB error' },
    })
    const round = { ...PLAYING_ROUND, hand_size: 2, round_number: 1 }

    const result = await autoResolvePlay(admin as unknown as ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>, 'game-1', 'room-1', round)

    expect(admin.rsInsert).toHaveBeenCalled() // round_scores committed before the failure
    expect(admin.handsInsert).toHaveBeenCalledTimes(1) // insert was reached and failed
    expect(result.ok).toBe(false)
    expect((result as { ok: false; error: string }).error).toBe('Failed to deal next round hands')
  })

  it('inserts game_results for non-dropped players only on last round', async () => {
    // hand_size=1 → last round. player-2 is dropped
    const playersWithDropped = [
      { user_id: 'player-1', seat_order: 0, status: 'active' },
      { user_id: 'player-2', seat_order: 1, status: 'dropped' },
    ]
    const admin = makePlayAdminMock({
      handRows: [{ player_id: 'player-1' }, { player_id: 'player-2' }],
      players: playersWithDropped,
      allTricks: [
        { id: 'trick-1', trick_number: 1, led_suit: 'spades', winner_id: null },
      ],
      handRowCards: [{ suit: 'spades', value: '2' }],
      playedByPlayer: [],
      existingTrickCards: [{ player_id: 'player-2', suit: 'spades', value: 'K' }],
      roundBids: [
        { player_id: 'player-1', amount: 0 },
        { player_id: 'player-2', amount: 0 },
      ],
      completedTricks: [],
      // round_scores for totalScores — only player-1 (player-2 was dropped before this round)
      allRoundScores: [{ player_id: 'player-1', score: 10 }],
    })
    const round = { ...PLAYING_ROUND, hand_size: 1, round_number: 1 } // last round

    await autoResolvePlay(admin as unknown as ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>, 'game-1', 'room-1', round)

    const insertCalls = (admin.gameResultsInsert as ReturnType<typeof vi.fn>).mock.calls
    expect(insertCalls.length).toBeGreaterThan(0)
    const insertArg = insertCalls[0][0] as Array<{ player_id: string }>
    const insertedPlayerIds = insertArg.map((r) => r.player_id)
    // player-2 is dropped — must not appear in game_results from autoResolvePlay
    expect(insertedPlayerIds).not.toContain('player-2')
    expect(insertedPlayerIds).toContain('player-1')
  })

  it('completes trick when dropped player card is already in existingTrickCards', async () => {
    // Invariant: resolveDroppedTurnChain auto-plays for dropped players before the next
    // active player's turn begins. So existingTrickCards ALREADY includes p2's auto-card.
    // 3 players: p1 active, p2 dropped (auto-played), p3 active (current).
    // existingTrickCards = [p1's card, p2's auto-card]. totalPlayed = 2+1 = 3 = players.length.
    // totalPlayed < players.length(3) → false → trick completes.
    const playersWithDropped = [
      { user_id: 'player-1', seat_order: 0, status: 'active' },
      { user_id: 'player-2', seat_order: 1, status: 'dropped' },
      { user_id: 'player-3', seat_order: 2, status: 'active' },
    ]
    const admin = makePlayAdminMock({
      handRows: [{ player_id: 'player-1' }, { player_id: 'player-2' }, { player_id: 'player-3' }],
      players: playersWithDropped,
      allTricks: [{ id: 'trick-1', trick_number: 1, led_suit: 'hearts', winner_id: null }],
      handRowCards: [{ suit: 'hearts', value: '2' }],
      playedByPlayer: [],
      // p2's card already in DB (auto-played by resolveDroppedTurnChain before p3's turn)
      existingTrickCards: [
        { player_id: 'player-1', suit: 'hearts', value: 'K' },
        { player_id: 'player-2', suit: 'hearts', value: 'Q' },
      ],
      roundBids: [
        { player_id: 'player-1', amount: 0 },
        { player_id: 'player-2', amount: 0 },
        { player_id: 'player-3', amount: 0 },
      ],
      completedTricks: [],
    })
    const round = { ...PLAYING_ROUND, hand_size: 1, current_player_id: 'player-3', round_number: 1 }

    const result = await autoResolvePlay(admin as unknown as ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>, 'game-1', 'room-1', round)

    expect(result.ok).toBe(true)
    expect((result as { ok: true; status: string }).status).not.toBe('trick_in_progress')
  })

  it('only inserts round_scores for non-dropped players', async () => {
    // player-2 is dropped — should not get a round_score
    const playersWithDropped = [
      { user_id: 'player-1', seat_order: 0, status: 'active' },
      { user_id: 'player-2', seat_order: 1, status: 'dropped' },
    ]
    const admin = makePlayAdminMock({
      handRows: [{ player_id: 'player-1' }, { player_id: 'player-2' }],
      players: playersWithDropped,
      allTricks: [
        { id: 'trick-1', trick_number: 1, led_suit: 'spades', winner_id: 'player-2' },
        { id: 'trick-2', trick_number: 2, led_suit: 'spades', winner_id: null },
      ],
      handRowCards: [{ suit: 'spades', value: '2' }],
      playedByPlayer: [{ suit: 'spades', value: 'K' }],
      existingTrickCards: [{ player_id: 'player-2', suit: 'spades', value: '3' }],
      roundBids: [
        { player_id: 'player-1', amount: 1 },
        { player_id: 'player-2', amount: 1 },
      ],
      completedTricks: [{ winner_id: 'player-2' }],
    })
    const round = { ...PLAYING_ROUND, hand_size: 2, round_number: 1 }

    await autoResolvePlay(admin as unknown as ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>, 'game-1', 'room-1', round)

    const rsInsertArg = (admin.rsInsert as ReturnType<typeof vi.fn>).mock.calls[0][0] as Array<{ player_id: string }>
    const scoredPlayerIds = rsInsertArg.map((r) => r.player_id)
    expect(scoredPlayerIds).not.toContain('player-2')
    expect(scoredPlayerIds).toContain('player-1')
  })
})

// ─── resolveDroppedTurnChain ──────────────────────────────────────────────────

describe('resolveDroppedTurnChain', () => {
  function makeChainAdmin({
    roundData = {
      id: 'round-1', round_number: 1, hand_size: 3, status: 'bidding',
      current_player_id: 'player-2', trump_suit: 'spades', turn_started_at: '2026-01-01T00:00:00.000Z',
    } as Record<string, unknown> | null,
    currentPlayerStatus = 'dropped' as string,
    claimSucceeds = true,
    bidsInsertError = null as unknown,
  } = {}) {
    // Build a reusable round SELECT chain factory
    function makeRoundSelectChain(data: Record<string, unknown> | null) {
      const maybeSingle = vi.fn().mockResolvedValue({ data })
      const limit = vi.fn().mockReturnValue({ maybeSingle })
      const order = vi.fn().mockReturnValue({ limit })
      const inFn = vi.fn().mockReturnValue({ order })
      const eq = vi.fn().mockReturnValue({ in: inFn })
      const select = vi.fn().mockReturnValue({ eq })
      return select
    }

    // First round SELECT returns the round; second returns null (loop exits)
    let roundSelectCallCount = 0
    const roundSelectFirst = makeRoundSelectChain(roundData)
    const roundSelectSecond = makeRoundSelectChain(null)

    // rounds UPDATE claim: .update({turn_started_at}).eq('id').eq('turn_started_at').select('id')
    const claimSelectId = vi.fn().mockResolvedValue({ data: claimSucceeds ? [{ id: 'round-1' }] : [] })
    const claimEq2 = vi.fn().mockReturnValue({ select: claimSelectId })
    const claimEq1 = vi.fn().mockReturnValue({ eq: claimEq2 })
    const claimUpdate = vi.fn().mockReturnValue({ eq: claimEq1 })

    // rounds UPDATE advance: .update({}).eq()
    const roundAdvanceEq = vi.fn().mockResolvedValue({ error: null })
    const roundAdvance = vi.fn().mockReturnValue({ eq: roundAdvanceEq })

    // Build a reusable room_players status SELECT chain factory
    function makeRpStatusChain(status: string) {
      const maybeSingle = vi.fn().mockResolvedValue({ data: { status } })
      const eq2 = vi.fn().mockReturnValue({ maybeSingle })
      const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
      return vi.fn().mockReturnValue({ eq: eq1 })
    }

    // First status check: currentPlayerStatus; second: 'active' (so loop exits)
    let cpSelectCallCount = 0
    const cpSelectFirst = makeRpStatusChain(currentPlayerStatus)
    const cpSelectSecond = makeRpStatusChain('active')

    // room_players SELECT list for autoResolveBid: .select().eq('room_id').in().order()
    const rpOrder = vi.fn().mockResolvedValue({ data: TWO_PLAYERS })
    const rpIn = vi.fn().mockReturnValue({ order: rpOrder })
    const rpEq = vi.fn().mockReturnValue({ in: rpIn })
    const rpListSelect = vi.fn().mockReturnValue({ eq: rpEq })

    // hands SELECT player_id list: .select('player_id').eq('round_id')
    const handsListEq = vi.fn().mockResolvedValue({ data: [{ player_id: 'player-1' }, { player_id: 'player-2' }] })
    const handsListSelect = vi.fn().mockReturnValue({ eq: handsListEq })
    const handsInsert = vi.fn().mockResolvedValue({ error: null })

    // bids SELECT: .select('amount').eq()
    const bidsSelectEq = vi.fn().mockResolvedValue({ data: [] })
    const bidsSelect = vi.fn().mockReturnValue({ eq: bidsSelectEq })
    const bidsInsert = vi.fn().mockResolvedValue({ error: bidsInsertError })

    // tricks INSERT
    const tricksInsert = vi.fn().mockResolvedValue({ error: null })

    // prev round SELECT for autoResolveBid isLastBidder path
    const prevRoundMaybeSingle = vi.fn().mockResolvedValue({ data: null })
    const prevRoundEq2 = vi.fn().mockReturnValue({ maybeSingle: prevRoundMaybeSingle })
    const prevRoundEq1 = vi.fn().mockReturnValue({ eq: prevRoundEq2 })
    const prevRoundSelect = vi.fn().mockReturnValue({ eq: prevRoundEq1 })

    let rpCallCount = 0
    let roundsCallCount = 0
    let handsCallCount = 0

    const fromMock = vi.fn().mockImplementation((table: string) => {
      if (table === 'rounds') {
        const idx = roundsCallCount++
        // Pattern: SELECT(0), UPDATE-claim(1), UPDATE-advance(2), SELECT(3), UPDATE-claim(4)...
        // The active round SELECT occurs at idx=0 and then again every 3 calls thereafter
        if (idx === 0) return { select: roundSelectFirst }   // 1st active round SELECT
        if (idx === 1) return { update: claimUpdate }        // claim lock
        if (idx === 2) return { update: roundAdvance }       // advance UPDATE
        if (idx === 3) return { select: roundSelectSecond }  // 2nd active round SELECT (loop breaks here → null)
        return { select: prevRoundSelect, update: roundAdvance }
      }
      if (table === 'room_players') {
        const idx = rpCallCount++
        if (idx === 0) {
          // Current player status check — use first or second based on cpSelectCallCount
          const sel = cpSelectCallCount++ === 0 ? cpSelectFirst : cpSelectSecond
          return { select: sel }
        }
        return { select: rpListSelect }                 // player list for autoResolveBid
      }
      if (table === 'hands') {
        const idx = handsCallCount++
        if (idx === 0) return { select: handsListSelect }  // player_id list
        return { insert: handsInsert }
      }
      if (table === 'bids') return { select: bidsSelect, insert: bidsInsert }
      if (table === 'tricks') return { insert: tricksInsert }
      throw new Error(`Unexpected table in chain mock: ${table}`)
    })

    return { from: fromMock, claimUpdate, bidsInsert }
  }

  it('does nothing when no active round', async () => {
    const admin = makeChainAdmin({ roundData: null })
    await resolveDroppedTurnChain(admin as unknown as ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>, 'game-1', 'room-1')
    expect(admin.claimUpdate).not.toHaveBeenCalled()
  })

  it('does nothing when current player is not dropped', async () => {
    const admin = makeChainAdmin({ currentPlayerStatus: 'active' })
    await resolveDroppedTurnChain(admin as unknown as ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>, 'game-1', 'room-1')
    // claim should not be attempted
    expect(admin.claimUpdate).not.toHaveBeenCalled()
  })

  it('does nothing when claim fails (concurrent caller won race)', async () => {
    const admin = makeChainAdmin({ claimSucceeds: false })
    await resolveDroppedTurnChain(admin as unknown as ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>, 'game-1', 'room-1')
    expect(admin.claimUpdate).toHaveBeenCalledTimes(1)
    // Did not call bidsInsert (no auto-resolve happened)
    expect(admin.bidsInsert).not.toHaveBeenCalled()
  })

  it('calls auto-resolve when current player is dropped', async () => {
    const admin = makeChainAdmin({ currentPlayerStatus: 'dropped' })
    await resolveDroppedTurnChain(admin as unknown as ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>, 'game-1', 'room-1')
    expect(admin.claimUpdate).toHaveBeenCalled()
    expect(admin.bidsInsert).toHaveBeenCalled()
  })

  it('stops the chain and logs when auto-resolve returns ok:false', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const admin = makeChainAdmin({
      currentPlayerStatus: 'dropped',
      bidsInsertError: { message: 'DB error' },
    })
    await resolveDroppedTurnChain(admin as unknown as ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>, 'game-1', 'room-1')
    expect(admin.bidsInsert).toHaveBeenCalledTimes(1)
    expect(consoleSpy).toHaveBeenCalledWith(
      '[autoResolve] resolveDroppedTurnChain stopped:',
      'Failed to record auto-bid'
    )
    consoleSpy.mockRestore()
  })
})
