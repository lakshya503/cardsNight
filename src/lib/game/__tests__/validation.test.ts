import { describe, it, expect } from 'vitest'
import { validateCreateRoomInput } from '../validation'
import type { GameType } from '../types'

describe('validateCreateRoomInput', () => {
  const validInput = {
    game_type: 'judgement' as GameType,
    max_players: 6,
    turn_timer_seconds: 30,
  }

  it('returns no errors for valid input', () => {
    expect(validateCreateRoomInput(validInput)).toEqual([])
  })

  it('returns no errors when turn_timer_seconds is omitted', () => {
    const { turn_timer_seconds: _, ...input } = validInput
    expect(validateCreateRoomInput(input)).toEqual([])
  })

  it('returns no errors when turn_timer_seconds is null', () => {
    expect(validateCreateRoomInput({ ...validInput, turn_timer_seconds: null })).toEqual([])
  })

  // game_type
  it('rejects unknown game_type', () => {
    const errors = validateCreateRoomInput({ ...validInput, game_type: 'poker' as GameType })
    expect(errors).toHaveLength(1)
    expect(errors[0].field).toBe('game_type')
  })

  it('rejects empty game_type', () => {
    const errors = validateCreateRoomInput({ ...validInput, game_type: '' as GameType })
    expect(errors[0].field).toBe('game_type')
  })

  // max_players
  it('rejects max_players below minimum (2)', () => {
    const errors = validateCreateRoomInput({ ...validInput, max_players: 1 })
    expect(errors[0].field).toBe('max_players')
  })

  it('rejects max_players above maximum (10)', () => {
    const errors = validateCreateRoomInput({ ...validInput, max_players: 11 })
    expect(errors[0].field).toBe('max_players')
  })

  it('accepts max_players at boundary values (2 and 10)', () => {
    expect(validateCreateRoomInput({ ...validInput, max_players: 2 })).toEqual([])
    expect(validateCreateRoomInput({ ...validInput, max_players: 10 })).toEqual([])
  })

  it('rejects non-integer max_players', () => {
    const errors = validateCreateRoomInput({ ...validInput, max_players: 5.5 })
    expect(errors[0].field).toBe('max_players')
  })

  // turn_timer_seconds
  it('rejects turn_timer_seconds below minimum (15)', () => {
    const errors = validateCreateRoomInput({ ...validInput, turn_timer_seconds: 14 })
    expect(errors[0].field).toBe('turn_timer_seconds')
  })

  it('rejects turn_timer_seconds above maximum (120)', () => {
    const errors = validateCreateRoomInput({ ...validInput, turn_timer_seconds: 121 })
    expect(errors[0].field).toBe('turn_timer_seconds')
  })

  it('accepts turn_timer_seconds at boundary values (15 and 120)', () => {
    expect(validateCreateRoomInput({ ...validInput, turn_timer_seconds: 15 })).toEqual([])
    expect(validateCreateRoomInput({ ...validInput, turn_timer_seconds: 120 })).toEqual([])
  })

  it('rejects non-integer turn_timer_seconds', () => {
    const errors = validateCreateRoomInput({ ...validInput, turn_timer_seconds: 30.5 })
    expect(errors[0].field).toBe('turn_timer_seconds')
  })

  it('returns multiple errors when multiple fields are invalid', () => {
    const errors = validateCreateRoomInput({
      game_type: 'chess' as GameType,
      max_players: 1,
      turn_timer_seconds: 5,
    })
    expect(errors).toHaveLength(3)
    expect(errors.map((e) => e.field)).toEqual(
      expect.arrayContaining(['game_type', 'max_players', 'turn_timer_seconds'])
    )
  })
})
