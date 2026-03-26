import { describe, it, expect } from 'vitest'
import { validateGuestName } from '@/lib/auth/guestName'

describe('validateGuestName', () => {
  it('returns the trimmed name for a valid input', () => {
    expect(validateGuestName('Alice')).toBe('Alice')
  })

  it('trims surrounding whitespace', () => {
    expect(validateGuestName('  Bob  ')).toBe('Bob')
  })

  it('returns null for an empty string', () => {
    expect(validateGuestName('')).toBeNull()
  })

  it('returns null for a whitespace-only string', () => {
    expect(validateGuestName('   ')).toBeNull()
  })

  it('returns null for a name longer than 24 characters', () => {
    expect(validateGuestName('a'.repeat(25))).toBeNull()
  })

  it('accepts a name of exactly 24 characters', () => {
    expect(validateGuestName('a'.repeat(24))).toBe('a'.repeat(24))
  })

  it('accepts a single character name', () => {
    expect(validateGuestName('X')).toBe('X')
  })

  it('returns null for a non-string (null)', () => {
    expect(validateGuestName(null)).toBeNull()
  })

  it('returns null for a name with HTML characters', () => {
    expect(validateGuestName('<script>')).toBeNull()
  })

  it('accepts names with accented characters', () => {
    expect(validateGuestName('André')).toBe('André')
  })
})
