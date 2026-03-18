import type { Card, CardValue, GameResult, Suit } from './types'
import { CARD_RANK } from './types'
import type { TrickCard } from './types'

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const SUITS: Suit[] = ['hearts', 'diamonds', 'clubs', 'spades']
const VALUES: CardValue[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']

function createDeck(): Card[] {
  const deck: Card[] = []
  for (const suit of SUITS) {
    for (const value of VALUES) {
      deck.push({ suit, value })
    }
  }
  return deck
}

function shuffle<T>(arr: T[]): T[] {
  const result = [...arr]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

// ---------------------------------------------------------------------------
// Round structure
// ---------------------------------------------------------------------------

export function getStartingHandSize(playerCount: number): number {
  if (playerCount <= 3) return 10
  if (playerCount <= 6) return 8
  if (playerCount === 7) return 7
  if (playerCount === 8) return 6
  return 5 // 9–10 players
}

// Returns descending sequence [startingHandSize, ..., 1]
export function getRoundSequence(startingHandSize: number): number[] {
  return Array.from({ length: startingHandSize }, (_, i) => startingHandSize - i)
}

// 0-indexed seat position of the player who leads round N (0-indexed wrap)
export function getStartingBidderIndex(roundNumber: number, playerCount: number): number {
  return (roundNumber - 1) % playerCount
}

// ---------------------------------------------------------------------------
// Dealing
// ---------------------------------------------------------------------------

// Deals handSize cards to each player from a freshly shuffled 52-card deck.
// Returns an immutable snapshot — caller stores this in hands rows.
export function dealHands(playerIds: string[], handSize: number): Record<string, Card[]> {
  const deck = shuffle(createDeck())
  const hands: Record<string, Card[]> = {}
  playerIds.forEach((id, i) => {
    hands[id] = deck.slice(i * handSize, (i + 1) * handSize)
  })
  return hands
}

// The trump card is the first card of the remaining deck after dealing.
export function drawTrump(deck: Card[]): { trumpCard: Card; trumpSuit: Suit; remaining: Card[] } {
  const trumpCard = deck[0]
  return { trumpCard, trumpSuit: trumpCard.suit, remaining: deck.slice(1) }
}

// ---------------------------------------------------------------------------
// Bidding
// ---------------------------------------------------------------------------

// Returns all legal bid amounts for the current bidder.
// Last bidder cannot bid the number that would make total bids equal handSize.
export function getValidBids(
  handSize: number,
  existingBids: number[],
  isLastBidder: boolean,
): number[] {
  const all = Array.from({ length: handSize + 1 }, (_, i) => i)
  if (!isLastBidder) return all
  const existingTotal = existingBids.reduce((sum, b) => sum + b, 0)
  const forbidden = handSize - existingTotal
  return all.filter((b) => b !== forbidden)
}

export function validateBid(amount: number, validBids: number[]): boolean {
  return validBids.includes(amount)
}

// ---------------------------------------------------------------------------
// Card play
// ---------------------------------------------------------------------------

// The suit led in a trick is the suit of the first card played.
export function getLeadSuit(trickCards: TrickCard[]): Suit | null {
  return trickCards[0]?.suit ?? null
}

export function canFollowSuit(hand: Card[], leadSuit: Suit): boolean {
  return hand.some((c) => c.suit === leadSuit)
}

// A play is invalid if:
//   - the card is not in the player's hand, OR
//   - a lead suit exists, the player can follow it, and the card doesn't follow it
export function validatePlay(card: Card, hand: Card[], leadSuit: Suit | null): boolean {
  const inHand = hand.some((c) => c.suit === card.suit && c.value === card.value)
  if (!inHand) return false
  if (leadSuit !== null && canFollowSuit(hand, leadSuit) && card.suit !== leadSuit) return false
  return true
}

// ---------------------------------------------------------------------------
// Trick resolution
// ---------------------------------------------------------------------------

// Trump beats all non-trump; highest CARD_RANK wins within a suit.
// If multiple trumps, highest trump wins. If no trump, highest lead-suit card wins.
export function getTrickWinner(
  trickCards: TrickCard[],
  trumpSuit: Suit,
  leadSuit: Suit,
): string {
  const trumpCards = trickCards.filter((c) => c.suit === trumpSuit)
  const candidates = trumpCards.length > 0 ? trumpCards : trickCards.filter((c) => c.suit === leadSuit)
  return candidates.reduce((best, c) => (CARD_RANK[c.value] > CARD_RANK[best.value] ? c : best))
    .playerId
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

// Exact bid = 10 × bid; bid of 0 exact = 10 pts (not 0). Missed bid = 0 pts.
export function scoreRound(
  bids: Record<string, number>,
  tricksWon: Record<string, number>,
): Record<string, number> {
  const scores: Record<string, number> = {}
  for (const playerId of Object.keys(bids)) {
    const bid = bids[playerId]
    const won = tricksWon[playerId] ?? 0
    scores[playerId] = won === bid ? (bid === 0 ? 10 : bid * 10) : 0
  }
  return scores
}

export function tallyFinalScores(roundScores: Array<Record<string, number>>): Record<string, number> {
  const totals: Record<string, number> = {}
  for (const round of roundScores) {
    for (const [playerId, score] of Object.entries(round)) {
      totals[playerId] = (totals[playerId] ?? 0) + score
    }
  }
  return totals
}

// Dense ranking: ties share a placement; next distinct score gets next consecutive rank.
// Only placement === 1 yields result 'win'; all others yield 'loss'.
export function determinePlacements(
  totalScores: Record<string, number>,
): Array<{ playerId: string; placement: number; result: GameResult }> {
  const entries = Object.entries(totalScores).sort(([, a], [, b]) => b - a)
  const uniqueScores = [...new Set(entries.map(([, s]) => s))].sort((a, b) => b - a)
  return entries.map(([playerId, score]) => {
    const placement = uniqueScores.indexOf(score) + 1
    return { playerId, placement, result: placement === 1 ? 'win' : 'loss' }
  })
}
