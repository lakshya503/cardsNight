import { describe, it, expect } from 'vitest'
import { getRoundOpener } from '@/lib/game/getRoundOpener'
import type { RoundStatus } from '@/lib/game/types'

const playerMap = {
  'player-1': { userId: 'player-1', seatOrder: 0, displayName: 'Alice' },
  'player-2': { userId: 'player-2', seatOrder: 1, displayName: 'Bob' },
}

const biddingRound = {
  id: 'r1',
  round_number: 1,
  hand_size: 8,
  trump_suit: 'spades',
  trump_card_value: '4',
  status: 'bidding' as RoundStatus,
  current_player_id: 'player-1',
  turn_started_at: null,
}

describe('getRoundOpener', () => {
  it('returns the opener display name before any bid is placed', () => {
    expect(getRoundOpener(biddingRound, [], playerMap)).toBe('Alice')
  })

  it('returns null once any bid has been placed', () => {
    const bids = [{ player_id: 'player-1', amount: 2 }]
    expect(getRoundOpener(biddingRound, bids, playerMap)).toBeNull()
  })

  it('returns null when round status is playing', () => {
    const playingRound = { ...biddingRound, status: 'playing' as RoundStatus }
    expect(getRoundOpener(playingRound, [], playerMap)).toBeNull()
  })

  it('returns null when round status is complete', () => {
    const completeRound = { ...biddingRound, status: 'complete' as RoundStatus }
    expect(getRoundOpener(completeRound, [], playerMap)).toBeNull()
  })

  it('returns null when round is null', () => {
    expect(getRoundOpener(null, [], playerMap)).toBeNull()
  })

  it('returns null when current_player_id is null', () => {
    const round = { ...biddingRound, current_player_id: null }
    expect(getRoundOpener(round, [], playerMap)).toBeNull()
  })

  it('returns null when current_player_id is not in playerMap', () => {
    expect(getRoundOpener(biddingRound, [], {})).toBeNull()
  })
})
