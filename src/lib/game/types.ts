// Canonical card representation — used everywhere: DB, API, client
export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades'
export type CardValue = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A'

export type Card = {
  suit: Suit
  value: CardValue
}

// Room
export type RoomStatus = 'waiting' | 'in_progress' | 'finished' | 'cancelled'

// Player within a room
export type RoomPlayerStatus = 'active' | 'disconnected' | 'dropped'

// Game
export type GameStatus = 'in_progress' | 'finished'

// Round
export type RoundStatus = 'bidding' | 'playing' | 'complete'

// Game result
export type GameResult = 'win' | 'loss' | 'tie'

// Supported game types — extend when adding new games (M5)
export type GameType = 'judgement'

// Card played within a trick — includes the player who played it
export interface TrickCard {
  playerId: string
  suit: Suit
  value: CardValue
}

// Canonical rank map — higher number beats lower; shared by gameRules.ts and tests
export const CARD_RANK: Record<CardValue, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8,
  '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14,
}
