import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse, type NextRequest } from 'next/server'
import { getPlayerHand } from '@/lib/game/server'

interface RouteContext {
  params: Promise<{ gameId: string }>
}

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { gameId } = await params
  const supabase = await createClient()
  const admin = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: game } = await admin
    .from('games')
    .select('id, room_id, status')
    .eq('id', gameId)
    .maybeSingle()

  if (!game || game.status !== 'in_progress') {
    return NextResponse.json({ error: 'Game not found or not in progress' }, { status: 404 })
  }

  const { data: roomPlayer } = await admin
    .from('room_players')
    .select('id')
    .eq('room_id', game.room_id)
    .eq('user_id', user.id)
    .in('status', ['active', 'disconnected'])
    .maybeSingle()

  if (!roomPlayer) {
    return NextResponse.json({ error: 'Not a player in this game' }, { status: 403 })
  }

  // Current round — hand is per-round
  const { data: round } = await admin
    .from('rounds')
    .select('id')
    .eq('game_id', gameId)
    .in('status', ['bidding', 'playing'])
    .order('round_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!round) {
    return NextResponse.json({ cards: [] }, { status: 200 })
  }

  const cards = await getPlayerHand(admin, round.id, user.id)
  return NextResponse.json({ cards }, { status: 200 })
}
