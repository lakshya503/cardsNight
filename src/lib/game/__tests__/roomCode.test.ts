import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateRoomCode, generateUniqueRoomCode } from '../roomCode'
import type { SupabaseClient } from '@supabase/supabase-js'

const VALID_CHARSET = new Set('ABCDEFGHJKMNPQRSTUVWXYZ23456789')
const CODE_LENGTH = 7

// ── generateRoomCode ──────────────────────────────────────────────────────────

describe('generateRoomCode', () => {
  it('generates a code of exactly 7 characters', () => {
    const code = generateRoomCode()
    expect(code).toHaveLength(CODE_LENGTH)
  })

  it('only contains characters from the valid charset', () => {
    // Run many times to increase confidence across the charset
    for (let i = 0; i < 200; i++) {
      const code = generateRoomCode()
      for (const char of code) {
        expect(VALID_CHARSET.has(char), `Invalid char '${char}' in code '${code}'`).toBe(true)
      }
    }
  })

  it('never contains ambiguous characters (0, O, 1, I, L)', () => {
    const ambiguous = new Set(['0', 'O', '1', 'I', 'L'])
    for (let i = 0; i < 200; i++) {
      const code = generateRoomCode()
      for (const char of code) {
        expect(ambiguous.has(char), `Ambiguous char '${char}' found in code '${code}'`).toBe(false)
      }
    }
  })

  it('produces different codes on successive calls', () => {
    const codes = new Set(Array.from({ length: 20 }, () => generateRoomCode()))
    // Statistically impossible to get all the same — if this fails, RNG is broken
    expect(codes.size).toBeGreaterThan(1)
  })
})

// ── generateUniqueRoomCode ────────────────────────────────────────────────────

function makeMockSupabase(responses: Array<{ data: { id: string } | null; error: null }>) {
  let callCount = 0
  const maybeSingle = vi.fn(() => {
    const response = responses[callCount] ?? responses[responses.length - 1]
    callCount++
    return Promise.resolve(response)
  })

  const mockSupabase = {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      maybeSingle,
    }),
  } as unknown as SupabaseClient

  return { mockSupabase, maybeSingle }
}

describe('generateUniqueRoomCode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns a code when the first attempt is free', async () => {
    const { mockSupabase } = makeMockSupabase([{ data: null, error: null }])
    const code = await generateUniqueRoomCode(mockSupabase)
    expect(code).toHaveLength(CODE_LENGTH)
    for (const char of code) {
      expect(VALID_CHARSET.has(char)).toBe(true)
    }
  })

  it('retries when the first code is taken and returns the next free one', async () => {
    const { mockSupabase, maybeSingle } = makeMockSupabase([
      { data: { id: 'existing-room' }, error: null }, // first code taken
      { data: null, error: null },                    // second code free
    ])
    const code = await generateUniqueRoomCode(mockSupabase)
    expect(code).toHaveLength(CODE_LENGTH)
    expect(maybeSingle).toHaveBeenCalledTimes(2)
  })

  it('throws after MAX_RETRIES (10) if all codes are taken', async () => {
    const allTaken = Array.from({ length: 10 }, () => ({
      data: { id: 'existing-room' },
      error: null,
    }))
    const { mockSupabase, maybeSingle } = makeMockSupabase(allTaken)

    await expect(generateUniqueRoomCode(mockSupabase)).rejects.toThrow(
      'Failed to generate a unique room code after 10 attempts'
    )
    expect(maybeSingle).toHaveBeenCalledTimes(10)
  })

  it('throws immediately if the database query fails', async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        neq: vi.fn().mockReturnThis(),
        gt: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'connection refused' },
        }),
      }),
    } as unknown as SupabaseClient

    await expect(generateUniqueRoomCode(mockSupabase)).rejects.toThrow(
      'Room code uniqueness check failed: connection refused'
    )
  })
})
