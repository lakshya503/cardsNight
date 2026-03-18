import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import type { Card } from './types'

type AdminClient = SupabaseClient<Database>

/**
 * Returns a player's current hand for a round:
 * dealt cards (from hands table) minus cards they've already played (from trick_cards).
 */
export async function getPlayerHand(
  admin: AdminClient,
  roundId: string,
  userId: string,
): Promise<Card[]> {
  const { data: handRow } = await admin
    .from('hands')
    .select('cards')
    .eq('round_id', roundId)
    .eq('player_id', userId)
    .maybeSingle()

  if (!handRow) return []

  const { data: roundTricks } = await admin
    .from('tricks')
    .select('id')
    .eq('round_id', roundId)

  const trickIds = (roundTricks ?? []).map((t) => t.id)

  if (trickIds.length === 0) return handRow.cards as Card[]

  const { data: played } = await admin
    .from('trick_cards')
    .select('suit, value')
    .eq('player_id', userId)
    .in('trick_id', trickIds)

  const playedSet = new Set((played ?? []).map((c) => `${c.suit}:${c.value}`))
  return (handRow.cards as Card[]).filter((c) => !playedSet.has(`${c.suit}:${c.value}`))
}
