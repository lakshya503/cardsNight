import { createClient } from '@/lib/supabase/server'
import { generateUniqueRoomCode } from '@/lib/game/roomCode'
import { validateCreateRoomInput } from '@/lib/game/validation'
import { NextResponse, type NextRequest } from 'next/server'

export async function POST(request: NextRequest) {
  const supabase = await createClient()

  // Auth check
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Parse body
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { game_type, max_players, turn_timer_seconds } = body as {
    game_type: string
    max_players: number
    turn_timer_seconds?: number | null
  }

  // Validate
  const errors = validateCreateRoomInput({ game_type, max_players, turn_timer_seconds })

  if (errors.length > 0) {
    return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 422 })
  }

  // Generate unique room code
  let code: string
  try {
    code = await generateUniqueRoomCode(supabase)
  } catch (err) {
    console.error('[POST /api/rooms] Failed to generate room code:', err)
    return NextResponse.json({ error: 'Failed to generate room code' }, { status: 500 })
  }

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

  // Insert room
  const { data: room, error: roomError } = await supabase
    .from('rooms')
    .insert({
      code,
      host_id: user.id,
      game_type,
      max_players,
      turn_timer_seconds: turn_timer_seconds ?? null,
      expires_at: expiresAt,
    })
    .select('id')
    .single()

  if (roomError || !room) {
    console.error('[POST /api/rooms] Failed to insert room:', roomError)
    return NextResponse.json({ error: 'Failed to create room' }, { status: 500 })
  }

  // Insert host as first player — if this fails, clean up the room
  const { error: playerError } = await supabase
    .from('room_players')
    .insert({
      room_id: room.id,
      user_id: user.id,
      status: 'active',
    })

  if (playerError) {
    console.error('[POST /api/rooms] Failed to insert host as player:', playerError)
    await supabase.from('rooms').delete().eq('id', room.id)
    return NextResponse.json({ error: 'Failed to create room' }, { status: 500 })
  }

  return NextResponse.json({ roomId: room.id, code }, { status: 201 })
}
