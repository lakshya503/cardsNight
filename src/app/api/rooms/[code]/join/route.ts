import { createClient } from '@/lib/supabase/server'
import { NextResponse, type NextRequest } from 'next/server'

interface RouteContext {
  params: Promise<{ code: string }>
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { code } = await params
  const supabase = await createClient()

  // Auth check
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Fetch room — must exist, not expired, not cancelled
  const { data: room, error: roomError } = await supabase
    .from('rooms')
    .select('id, status, max_players, code')
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

  // Room must be in waiting state
  if (room.status !== 'waiting') {
    return NextResponse.json(
      { error: 'This game has already started' },
      { status: 422 }
    )
  }

  // Check if player is already in the room
  const { data: existingPlayer, error: existingError } = await supabase
    .from('room_players')
    .select('id')
    .eq('room_id', room.id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (existingError) {
    console.error('[POST /api/rooms/[code]/join] Existing player check error:', existingError)
    return NextResponse.json({ error: 'Failed to check room membership' }, { status: 500 })
  }

  if (existingPlayer) {
    return NextResponse.json(
      { error: 'You are already in this room', roomId: room.id, code: room.code },
      { status: 409 }
    )
  }

  // Check current player count (excludes dropped players)
  const { count, error: countError } = await supabase
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
  const { error: insertError } = await supabase
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
