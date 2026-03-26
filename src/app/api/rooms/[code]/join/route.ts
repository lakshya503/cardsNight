import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse, type NextRequest } from 'next/server'

interface RouteContext {
  params: Promise<{ code: string }>
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { code } = await params
  const supabase = await createClient()
  const admin = createAdminClient()

  // Auth check
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Fetch room — must exist, not expired, not cancelled
  const { data: room, error: roomError } = await admin
    .from('rooms')
    .select('id, status, max_players, code, current_game_id')
    .eq('code', code.toUpperCase())
    .neq('status', 'cancelled')
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()

  if (roomError) {
    console.error('[POST /api/rooms/[code]/join] Room fetch error:', roomError)
    return NextResponse.json({ error: 'Failed to look up room' }, { status: 500 })
  }

  if (!room) {
    return NextResponse.json(
      { error: 'Room not found or has expired' },
      { status: 404 }
    )
  }

  // Check existing membership BEFORE the status check so that a player who was
  // already in the room can reconnect mid-game rather than hitting the 422 wall.
  const { data: existingPlayer, error: existingError } = await admin
    .from('room_players')
    .select('id, status')
    .eq('room_id', room.id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (existingError) {
    console.error('[POST /api/rooms/[code]/join] Existing player check error:', existingError)
    return NextResponse.json({ error: 'Failed to check room membership' }, { status: 500 })
  }

  if (existingPlayer) {
    const canRejoin = existingPlayer.status === 'active' || existingPlayer.status === 'disconnected'
    if (canRejoin && room.status === 'active' && room.current_game_id) {
      // Returning player mid-game — send them straight back in
      return NextResponse.json(
        { reconnecting: true, gameId: room.current_game_id, code: room.code },
        { status: 200 }
      )
    }
    // Dropped from the game, game not yet started, or game already finished
    let message = 'You are already in this room'
    if (existingPlayer.status === 'dropped') {
      message = 'You were dropped from this game and cannot rejoin.'
    } else if (room.status === 'finished') {
      message = 'This game has already finished.'
    }
    return NextResponse.json(
      { error: message, roomId: room.id, code: room.code },
      { status: 409 }
    )
  }

  // Room must be in waiting state for new players
  if (room.status !== 'waiting') {
    return NextResponse.json(
      { error: 'This game has already started. Next time!' },
      { status: 422 }
    )
  }

  // Check current player count (excludes dropped players)
  const { count, error: countError } = await admin
    .from('room_players')
    .select('id', { count: 'exact', head: true })
    .eq('room_id', room.id)
    .neq('status', 'dropped')

  if (countError) {
    console.error('[POST /api/rooms/[code]/join] Player count error:', countError)
    return NextResponse.json({ error: 'Failed to check room capacity' }, { status: 500 })
  }

  if ((count ?? 0) >= room.max_players) {
    return NextResponse.json(
      { error: 'This room is full' },
      { status: 422 }
    )
  }

  // Join the room
  const { error: insertError } = await admin
    .from('room_players')
    .insert({
      room_id: room.id,
      user_id: user.id,
      status: 'active',
    })

  if (insertError) {
    console.error('[POST /api/rooms/[code]/join] Insert error:', insertError)
    return NextResponse.json({ error: 'Failed to join room' }, { status: 500 })
  }

  return NextResponse.json({ roomId: room.id, code: room.code }, { status: 200 })
}
