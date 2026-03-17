import type { GameType } from './types'

export const VALID_GAME_TYPES: GameType[] = ['judgement']
export const MIN_PLAYERS = 4
export const MAX_PLAYERS = 10
export const MIN_TIMER_SECONDS = 15
export const MAX_TIMER_SECONDS = 120

export type CreateRoomInput = {
  game_type: string
  max_players: number
  turn_timer_seconds?: number | null
}

export type ValidationError = { field: string; message: string }

export function validateCreateRoomInput(input: CreateRoomInput): ValidationError[] {
  const errors: ValidationError[] = []

  if (!VALID_GAME_TYPES.includes(input.game_type as GameType)) {
    errors.push({
      field: 'game_type',
      message: `game_type must be one of: ${VALID_GAME_TYPES.join(', ')}`,
    })
  }

  if (
    !Number.isInteger(input.max_players) ||
    input.max_players < MIN_PLAYERS ||
    input.max_players > MAX_PLAYERS
  ) {
    errors.push({
      field: 'max_players',
      message: `max_players must be an integer between ${MIN_PLAYERS} and ${MAX_PLAYERS}`,
    })
  }

  if (input.turn_timer_seconds != null) {
    if (
      !Number.isInteger(input.turn_timer_seconds) ||
      input.turn_timer_seconds < MIN_TIMER_SECONDS ||
      input.turn_timer_seconds > MAX_TIMER_SECONDS
    ) {
      errors.push({
        field: 'turn_timer_seconds',
        message: `turn_timer_seconds must be an integer between ${MIN_TIMER_SECONDS} and ${MAX_TIMER_SECONDS}`,
      })
    }
  }

  return errors
}
