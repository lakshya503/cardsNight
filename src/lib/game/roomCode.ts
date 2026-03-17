import { SupabaseClient } from '@supabase/supabase-js'

// Excludes ambiguous characters: 0, O, 1, I, L
const CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 7
const MAX_RETRIES = 10

export function generateRoomCode(): string {
  let code = ''
  const array = new Uint8Array(CODE_LENGTH)
  crypto.getRandomValues(array)
  for (const byte of array) {
    code += CHARSET[byte % CHARSET.length]
  }
  return code
}

/**
 * Generates a room code guaranteed to be unique among active rooms.
 * A code is considered taken if a room with that code exists and is
 * not expired (expires_at > now()) and not cancelled.
 *
 * Throws if a unique code cannot be found within MAX_RETRIES attempts.
 */
export async function generateUniqueRoomCode(
  supabase: SupabaseClient
): Promise<string> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const code = generateRoomCode()

    const { data, error } = await supabase
      .from('rooms')
      .select('id')
      .eq('code', code)
      .neq('status', 'cancelled')
      .gt('expires_at', new Date().toISOString())
      .maybeSingle()

    if (error) throw new Error(`Room code uniqueness check failed: ${error.message}`)

    if (!data) return code // code is free
  }

  throw new Error(`Failed to generate a unique room code after ${MAX_RETRIES} attempts`)
}
