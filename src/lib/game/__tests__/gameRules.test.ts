import { describe, it, expect } from 'vitest'
import {
  getStartingHandSize,
  getRoundSequence,
  getStartingBidderIndex,
  dealHands,
  drawTrump,
  getValidBids,
  validateBid,
  getLeadSuit,
  canFollowSuit,
  validatePlay,
  getTrickWinner,
  scoreRound,
  tallyFinalScores,
  determinePlacements,
} from '../gameRules'
import type { Card, TrickCard } from '../types'

// ---------------------------------------------------------------------------
// Round structure
// ---------------------------------------------------------------------------

describe('getStartingHandSize', () => {
  it.each([
    [2, 10],
    [3, 10],
    [4, 8],
    [5, 8],
    [6, 8],
    [7, 7],
    [8, 6],
    [9, 5],
    [10, 5],
  ])('%i players → %i cards', (players, expected) => {
    expect(getStartingHandSize(players)).toBe(expected)
  })
})

describe('getRoundSequence', () => {
  it('returns descending sequence from startingHandSize to 1', () => {
    expect(getRoundSequence(8)).toEqual([8, 7, 6, 5, 4, 3, 2, 1])
  })

  it('returns [1] for startingHandSize of 1', () => {
    expect(getRoundSequence(1)).toEqual([1])
  })

  it('returns 10-element sequence for 2–3 player starting size', () => {
    expect(getRoundSequence(10)).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1])
  })
})

describe('getStartingBidderIndex', () => {
  it('round 1 → seat 0', () => {
    expect(getStartingBidderIndex(1, 4)).toBe(0)
  })

  it('round 2 → seat 1', () => {
    expect(getStartingBidderIndex(2, 4)).toBe(1)
  })

  it('wraps around when round > playerCount', () => {
    expect(getStartingBidderIndex(5, 4)).toBe(0)
    expect(getStartingBidderIndex(6, 4)).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Dealing
// ---------------------------------------------------------------------------

describe('dealHands', () => {
  it('gives each player the correct number of cards', () => {
    const { hands } = dealHands(['p1', 'p2', 'p3', 'p4'], 8)
    expect(Object.keys(hands)).toHaveLength(4)
    for (const hand of Object.values(hands)) {
      expect(hand).toHaveLength(8)
    }
  })

  it('deals no duplicate cards across players', () => {
    const { hands } = dealHands(['p1', 'p2', 'p3', 'p4'], 8)
    const all = Object.values(hands).flat().map((c) => `${c.suit}:${c.value}`)
    expect(new Set(all).size).toBe(all.length)
  })

  it('works for 2-player 10-card hands (largest deal)', () => {
    const { hands } = dealHands(['p1', 'p2'], 10)
    const all = Object.values(hands).flat()
    expect(all).toHaveLength(20)
    expect(new Set(all.map((c) => `${c.suit}:${c.value}`)).size).toBe(20)
  })

  it('returns remaining deck after dealing', () => {
    const { remaining } = dealHands(['p1', 'p2', 'p3', 'p4'], 8)
    // 52 - (4 * 8) = 20 remaining
    expect(remaining).toHaveLength(20)
  })
})

describe('drawTrump', () => {
  it('returns the first card of the deck as trump', () => {
    const deck: Card[] = [
      { suit: 'hearts', value: 'A' },
      { suit: 'spades', value: '2' },
    ]
    const { trumpCard, trumpSuit, remaining } = drawTrump(deck)
    expect(trumpCard).toEqual({ suit: 'hearts', value: 'A' })
    expect(trumpSuit).toBe('hearts')
    expect(remaining).toEqual([{ suit: 'spades', value: '2' }])
  })

  it('does not mutate the input deck', () => {
    const deck: Card[] = [{ suit: 'clubs', value: 'K' }, { suit: 'diamonds', value: '5' }]
    const originalLength = deck.length
    drawTrump(deck)
    expect(deck).toHaveLength(originalLength)
  })
})

// ---------------------------------------------------------------------------
// Bidding
// ---------------------------------------------------------------------------

describe('getValidBids', () => {
  it('returns all bids 0–handSize when not last bidder', () => {
    expect(getValidBids(8, [2, 3], false)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('excludes the forbidden bid for the last bidder', () => {
    // handSize=8, existing=[2,3,1] → total=6, forbidden=2
    const valid = getValidBids(8, [2, 3, 1], true)
    expect(valid).not.toContain(2)
    expect(valid).toContain(0)
    expect(valid).toContain(1)
    expect(valid).toContain(3)
    expect(valid).toHaveLength(8) // 9 bids minus 1 forbidden
  })

  it('allows all bids when forbidden value would be negative', () => {
    // handSize=3, existing=[2,2] → total=4, forbidden=-1 (not in range)
    const valid = getValidBids(3, [2, 2], true)
    expect(valid).toEqual([0, 1, 2, 3])
  })

  it('allows all bids when forbidden value exceeds handSize', () => {
    // handSize=3, existing=[0,0] → total=0, forbidden=3 — wait, 3 IS in range [0..3]
    // Let's use a case where forbidden > handSize: impossible since forbidden = handSize - total
    // and total >= 0, so forbidden <= handSize always. Test negative instead.
    // handSize=4, existing=[5] (hypothetically) → forbidden=-1
    const valid = getValidBids(4, [5], true)
    expect(valid).toEqual([0, 1, 2, 3, 4])
  })

  it('last bidder with 0 existing bids: forbidden = handSize', () => {
    // handSize=5, existing=[] → total=0, forbidden=5
    const valid = getValidBids(5, [], true)
    expect(valid).not.toContain(5)
    expect(valid).toHaveLength(5) // [0,1,2,3,4]
  })
})

describe('validateBid', () => {
  it('returns true for a valid bid', () => {
    expect(validateBid(3, [0, 1, 2, 3, 4])).toBe(true)
  })

  it('returns false for a bid not in validBids', () => {
    expect(validateBid(2, [0, 1, 3, 4])).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Card play
// ---------------------------------------------------------------------------

describe('getLeadSuit', () => {
  it('returns null when no cards have been played', () => {
    expect(getLeadSuit([])).toBeNull()
  })

  it('returns the suit of the first card played', () => {
    const cards: TrickCard[] = [
      { playerId: 'p1', suit: 'hearts', value: 'K' },
      { playerId: 'p2', suit: 'spades', value: 'A' },
    ]
    expect(getLeadSuit(cards)).toBe('hearts')
  })
})

describe('canFollowSuit', () => {
  it('returns true when hand contains a card of the lead suit', () => {
    const hand: Card[] = [
      { suit: 'hearts', value: '3' },
      { suit: 'spades', value: 'K' },
    ]
    expect(canFollowSuit(hand, 'hearts')).toBe(true)
  })

  it('returns false when hand contains no card of the lead suit', () => {
    const hand: Card[] = [
      { suit: 'clubs', value: '3' },
      { suit: 'spades', value: 'K' },
    ]
    expect(canFollowSuit(hand, 'hearts')).toBe(false)
  })
})

describe('validatePlay', () => {
  const hand: Card[] = [
    { suit: 'hearts', value: 'K' },
    { suit: 'hearts', value: '3' },
    { suit: 'spades', value: 'A' },
  ]

  it('rejects a card not in hand', () => {
    expect(validatePlay({ suit: 'clubs', value: '2' }, hand, null)).toBe(false)
  })

  it('accepts any card when no lead suit (leading a trick)', () => {
    expect(validatePlay({ suit: 'spades', value: 'A' }, hand, null)).toBe(true)
    expect(validatePlay({ suit: 'hearts', value: 'K' }, hand, null)).toBe(true)
  })

  it('accepts a card that follows the lead suit', () => {
    expect(validatePlay({ suit: 'hearts', value: 'K' }, hand, 'hearts')).toBe(true)
  })

  it('rejects an off-suit card when player can follow suit', () => {
    expect(validatePlay({ suit: 'spades', value: 'A' }, hand, 'hearts')).toBe(false)
  })

  it('accepts cutting (playing trump) when void in lead suit', () => {
    const voidHand: Card[] = [
      { suit: 'spades', value: 'A' },
      { suit: 'clubs', value: '2' },
    ]
    expect(validatePlay({ suit: 'spades', value: 'A' }, voidHand, 'hearts')).toBe(true)
  })

  it('accepts fusing (playing off-suit non-trump) when void in lead suit', () => {
    const voidHand: Card[] = [
      { suit: 'spades', value: 'A' },
      { suit: 'clubs', value: '2' },
    ]
    expect(validatePlay({ suit: 'clubs', value: '2' }, voidHand, 'hearts')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Trick resolution
// ---------------------------------------------------------------------------

describe('getTrickWinner', () => {
  it('highest lead-suit card wins when no trump played', () => {
    const cards: TrickCard[] = [
      { playerId: 'p1', suit: 'hearts', value: 'K' },
      { playerId: 'p2', suit: 'hearts', value: 'A' },
      { playerId: 'p3', suit: 'hearts', value: '9' },
    ]
    expect(getTrickWinner(cards, 'spades', 'hearts')).toBe('p2')
  })

  it('trump beats all non-trump cards including high lead-suit cards', () => {
    const cards: TrickCard[] = [
      { playerId: 'p1', suit: 'hearts', value: 'A' },
      { playerId: 'p2', suit: 'spades', value: '2' }, // trump
      { playerId: 'p3', suit: 'hearts', value: 'K' },
    ]
    expect(getTrickWinner(cards, 'spades', 'hearts')).toBe('p2')
  })

  it('highest trump wins when multiple trumps played', () => {
    const cards: TrickCard[] = [
      { playerId: 'p1', suit: 'hearts', value: 'A' },
      { playerId: 'p2', suit: 'spades', value: '2' }, // lower trump
      { playerId: 'p3', suit: 'spades', value: 'K' }, // higher trump
    ]
    expect(getTrickWinner(cards, 'spades', 'hearts')).toBe('p3')
  })

  it('off-suit non-trump cards are ignored (fuse play)', () => {
    const cards: TrickCard[] = [
      { playerId: 'p1', suit: 'hearts', value: '5' }, // lead
      { playerId: 'p2', suit: 'clubs', value: 'A' },  // fuse — high rank but irrelevant
      { playerId: 'p3', suit: 'hearts', value: '9' },
    ]
    expect(getTrickWinner(cards, 'spades', 'hearts')).toBe('p3')
  })
})

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

describe('scoreRound', () => {
  it('awards 10 × bid for an exact bid', () => {
    const scores = scoreRound({ p1: 3 }, { p1: 3 })
    expect(scores.p1).toBe(30)
  })

  it('awards 10 points for an exact bid of 0', () => {
    const scores = scoreRound({ p1: 0 }, { p1: 0 })
    expect(scores.p1).toBe(10)
  })

  it('awards 0 for a missed bid (too many tricks)', () => {
    const scores = scoreRound({ p1: 2 }, { p1: 3 })
    expect(scores.p1).toBe(0)
  })

  it('awards 0 for a missed bid (too few tricks)', () => {
    const scores = scoreRound({ p1: 3 }, { p1: 1 })
    expect(scores.p1).toBe(0)
  })

  it('scores all players correctly in a round', () => {
    const scores = scoreRound(
      { p1: 2, p2: 0, p3: 3 },
      { p1: 2, p2: 0, p3: 2 },
    )
    expect(scores).toEqual({ p1: 20, p2: 10, p3: 0 })
  })
})

describe('tallyFinalScores', () => {
  it('sums scores across all rounds', () => {
    const totals = tallyFinalScores([
      { p1: 20, p2: 0 },
      { p1: 10, p2: 30 },
      { p1: 0, p2: 10 },
    ])
    expect(totals).toEqual({ p1: 30, p2: 40 })
  })

  it('handles a single round', () => {
    expect(tallyFinalScores([{ p1: 50, p2: 20 }])).toEqual({ p1: 50, p2: 20 })
  })
})

describe('determinePlacements', () => {
  it('assigns placement 1 and win to the sole highest scorer', () => {
    const results = determinePlacements({ p1: 80, p2: 50, p3: 30 })
    const p1 = results.find((r) => r.playerId === 'p1')!
    expect(p1.placement).toBe(1)
    expect(p1.result).toBe('win')
  })

  it('assigns placement 2 and loss to non-winners', () => {
    const results = determinePlacements({ p1: 80, p2: 50 })
    const p2 = results.find((r) => r.playerId === 'p2')!
    expect(p2.placement).toBe(2)
    expect(p2.result).toBe('loss')
  })

  it('uses dense ranking — ties share a placement, next rank is consecutive', () => {
    // scores: p1=80, p2=80, p3=50 → placements: 1, 1, 2 (not 1, 1, 3)
    const results = determinePlacements({ p1: 80, p2: 80, p3: 50 })
    const p1 = results.find((r) => r.playerId === 'p1')!
    const p2 = results.find((r) => r.playerId === 'p2')!
    const p3 = results.find((r) => r.playerId === 'p3')!
    expect(p1.placement).toBe(1)
    expect(p2.placement).toBe(1)
    expect(p3.placement).toBe(2) // dense: next after 1 is 2, not 3
  })

  it('both tied first-place players get result win', () => {
    const results = determinePlacements({ p1: 80, p2: 80 })
    expect(results.every((r) => r.result === 'win')).toBe(true)
  })

  it('tied non-winners get result loss', () => {
    const results = determinePlacements({ p1: 80, p2: 50, p3: 50 })
    const p2 = results.find((r) => r.playerId === 'p2')!
    const p3 = results.find((r) => r.playerId === 'p3')!
    expect(p2.placement).toBe(2)
    expect(p2.result).toBe('loss')
    expect(p3.placement).toBe(2)
    expect(p3.result).toBe('loss')
  })

  it('handles a single player', () => {
    const results = determinePlacements({ p1: 40 })
    expect(results).toEqual([{ playerId: 'p1', placement: 1, result: 'win' }])
  })
})
