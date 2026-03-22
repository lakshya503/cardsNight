import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse, type NextRequest } from 'next/server'
import { autoResolveBid, autoResolvePlay } from '@/lib/game/autoResolve'

// Grace window: allow calls up to 1500ms before the computed expiry to
// account for clock skew between client and server.
const CLOCK_SKEW_MS = 1500

interface RouteContext {
  params: Promise<{ gameId: string }>
}

export async function POST(_request: NextRequest, { params }: RouteContext) {
  const { gameId } = await params
  const supabase = await createClient()
  const admin = createAdminClient()

  // Auth
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Fetch game
  const { data: game } = await admin
    .from('games')
    .select('id, room_id, status')
    .eq('id', gameId)
    .maybeSingle()

  if (!game || game.status !== 'in_progress') {
    return NextResponse.json({ error: 'Game not found or not in progress' }, { status: 404 })
  }

  // Fetch room for turn_timer_seconds (still needed for non-dropped turns)
  const { data: room } = await admin
    .from('rooms')
    .select('turn_timer_seconds')
    .eq('id', game.room_id)
    .maybeSingle()

  // Verify caller is an active player in this game's room
  const { data: roomPlayer } = await admin
    .from('room_players')
    .select('id')
    .eq('room_id', game.room_id)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle()

  if (!roomPlayer) {
    return NextResponse.json({ error: 'Not a player in this game' }, { status: 403 })
  }

  // Fetch current active round (bidding or playing)
  const { data: round } = await admin
    .from('rounds')
    .select('id, round_number, hand_size, status, current_player_id, trump_suit, turn_started_at')
    .eq('game_id', gameId)
    .in('status', ['bidding', 'playing'])
    .order('round_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!round || !round.turn_started_at || !round.current_player_id) {
    return NextResponse.json({ error: 'No active round' }, { status: 422 })
  }

  // Check if the current player is dropped — dropped players bypass the timer check entirely
  // so that auto-resolution works even in rooms without a turn timer configured.
  const { data: currentPlayerRecord } = await admin
    .from('room_players')
    .select('status')
    .eq('room_id', game.room_id)
    .eq('user_id', round.current_player_id as string)
    .maybeSingle()

  const isDroppedTurn = currentPlayerRecord?.status === 'dropped'

  if (!isDroppedTurn) {
    // Normal timer path: require a configured timer and verify it has expired
    if (!room || room.turn_timer_seconds === null) {
      return NextResponse.json({ error: 'Turn timer not configured for this room' }, { status: 422 })
    }
    const expiredAt = new Date(round.turn_started_at).getTime() + room.turn_timer_seconds * 1000
    if (Date.now() < expiredAt - CLOCK_SKEW_MS) {
      return NextResponse.json({ status: 'not_expired' }, { status: 200 })
    }
  }

  // Atomically claim this turn resolution to prevent double-resolution under concurrent requests.
  // Only the first caller whose WHERE matches will proceed; concurrent callers return gracefully.
  const { data: claimed } = await admin
    .from('rounds')
    .update({ turn_started_at: new Date().toISOString() })
    .eq('id', round.id)
    .eq('turn_started_at', round.turn_started_at)
    .select('id')

  if (!claimed || claimed.length === 0) {
    return NextResponse.json({ status: 'already_resolved' }, { status: 200 })
  }

  // Safe: current_player_id and turn_started_at are guaranteed non-null by the guard above
  const activeRound = round as typeof round & { current_player_id: string; turn_started_at: string }

  let result
  if (round.status === 'bidding') {
    result = await autoResolveBid(admin, gameId, game.room_id, activeRound)
  } else {
    result = await autoResolvePlay(admin, gameId, game.room_id, activeRound)
  }

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.httpStatus })
  }
  return NextResponse.json(
    result.winnerId ? { status: result.status, winnerId: result.winnerId } : { status: result.status },
    { status: 200 }
  )
}
