import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { GameShell } from './GameShell'
import { getPlayerHand } from '@/lib/game/server'

interface PageProps {
  params: Promise<{ gameId: string }>
}

export default async function GamePage({ params }: PageProps) {
  const { gameId } = await params
  const supabase = await createClient()
  const admin = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  // Fetch game
  const { data: game } = await admin
    .from('games')
    .select('id, status, room_id')
    .eq('id', gameId)
    .maybeSingle()

  if (!game) redirect('/')

  // Verify user is a player in this game
  const { data: roomPlayer } = await admin
    .from('room_players')
    .select('seat_order')
    .eq('room_id', game.room_id)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle()

  if (!roomPlayer) redirect('/')

  // Fetch room settings (for turn timer and room code)
  const { data: room } = await admin
    .from('rooms')
    .select('turn_timer_seconds, code')
    .eq('id', game.room_id)
    .maybeSingle()

  // Fetch current round
  const { data: round } = await admin
    .from('rounds')
    .select('id, round_number, hand_size, trump_suit, trump_card_value, status, current_player_id, turn_started_at')
    .eq('game_id', gameId)
    .order('round_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  // Fetch players in seat order with display names (active + disconnected)
  const { data: players } = await admin
    .from('room_players')
    .select('user_id, seat_order, profiles(display_name, avatar_url)')
    .eq('room_id', game.room_id)
    .in('status', ['active', 'disconnected'])
    .order('seat_order', { ascending: true })

  const playerList = (players ?? []).map((p) => {
    const profile = p.profiles as { display_name: string; avatar_url: string | null } | null
    return {
      userId: p.user_id,
      seatOrder: p.seat_order ?? 0,
      displayName: profile?.display_name ?? 'Player',
      avatarUrl: profile?.avatar_url ?? undefined,
    }
  })

  // Fetch existing bids for current round
  const { data: bids } = round
    ? await admin.from('bids').select('player_id, amount').eq('round_id', round.id)
    : { data: [] }

  // Fetch player's hand for the current round
  const hand = round ? await getPlayerHand(admin, round.id, user.id) : []

  // Compute cumulative scores from all completed round_scores for this game
  const { data: allRoundIds } = await admin
    .from('rounds')
    .select('id')
    .eq('game_id', gameId)

  const roundIds = (allRoundIds ?? []).map((r) => r.id)
  const cumulativeScores: Record<string, number> = {}
  if (roundIds.length > 0) {
    const { data: allScores } = await admin
      .from('round_scores')
      .select('player_id, score')
      .in('round_id', roundIds)
    for (const rs of allScores ?? []) {
      cumulativeScores[rs.player_id] = (cumulativeScores[rs.player_id] ?? 0) + rs.score
    }
  }

  // Compute tricks won per player in the current round (completed tricks only)
  const initialTricksWon: Record<string, number> = {}
  if (round?.status === 'playing') {
    const { data: completedTricks } = await admin
      .from('tricks')
      .select('winner_id')
      .eq('round_id', round.id)
      .not('winner_id', 'is', null)
    for (const t of completedTricks ?? []) {
      if (t.winner_id) {
        initialTricksWon[t.winner_id] = (initialTricksWon[t.winner_id] ?? 0) + 1
      }
    }
  }

  // Fetch current trick (latest without a winner) and its cards
  let currentTrick: { id: string; trick_number: number; led_suit: string | null; winner_id: string | null } | null = null
  let trickCards: Array<{ playerId: string; displayName: string; suit: string; value: string }> = []

  if (round?.status === 'playing') {
    const { data: allTricks } = await admin
      .from('tricks')
      .select('id, trick_number, led_suit, winner_id')
      .eq('round_id', round.id)
      .order('trick_number', { ascending: true })

    currentTrick = [...(allTricks ?? [])].reverse().find((t) => t.winner_id === null) ?? null

    if (currentTrick) {
      const { data: existingCards } = await admin
        .from('trick_cards')
        .select('player_id, suit, value')
        .eq('trick_id', currentTrick.id)

      const playerMap = Object.fromEntries(playerList.map((p) => [p.userId, p]))
      trickCards = (existingCards ?? []).map((tc) => ({
        playerId: tc.player_id,
        displayName: playerMap[tc.player_id]?.displayName ?? 'Player',
        suit: tc.suit,
        value: tc.value,
      }))
    }
  }

  // Fetch dropped players for this game (needed to initialise client state)
  const { data: droppedPlayerRows } = await admin
    .from('room_players')
    .select('user_id')
    .eq('room_id', game.room_id)
    .eq('status', 'dropped')
  const initialDroppedPlayers = (droppedPlayerRows ?? []).map((p) => p.user_id)

  return (
    <GameShell
      gameId={gameId}
      userId={user.id}
      initialRound={round ?? null}
      initialBids={bids ?? []}
      initialHand={hand}
      initialCurrentTrick={currentTrick}
      initialTrickCards={trickCards}
      initialCumulativeScores={cumulativeScores}
      initialTricksWon={initialTricksWon}
      players={playerList}
      turnTimerSeconds={room?.turn_timer_seconds ?? null}
      roomCode={room?.code ?? ''}
      initialDroppedPlayers={initialDroppedPlayers}
    />
  )
}
