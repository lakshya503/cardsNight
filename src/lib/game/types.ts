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
export type RoundStatus = 'bidding' | 'playing' | 'finished'

// Game result
export type GameResult = 'win' | 'loss' | 'tie'

// Supported game types — extend when adding new games (M5)
export type GameType = 'judgement'
