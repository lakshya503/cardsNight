/** Returns the opener's display name when it can be definitively determined,
 *  i.e. before any bid has been placed (current_player_id is still the first bidder).
 *  Returns null once bidding is underway or the round is in any other state. */
export function getRoundOpener(
  round: { status: string; current_player_id: string | null } | null,
  bids: { player_id: string; amount: number }[],
  playerMap: Record<string, { displayName: string }>,
): string | null {
  if (!round || round.status !== 'bidding' || bids.length > 0) return null
  if (!round.current_player_id) return null
  return playerMap[round.current_player_id]?.displayName ?? null
}
