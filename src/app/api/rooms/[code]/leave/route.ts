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

  // Fetch room — must exist and be in waiting state
  const { data: room } = await supabase
    .from('rooms')
    .select('id, host_id, status')
    .eq('code', code.toUpperCase())
    .neq('status', 'cancelled')
    .maybeSingle()

  if (!room) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 })
  }

  if (room.status !== 'waiting') {
    return NextResponse.json(
      { error: 'Cannot leave a game already in progress' },
      { status: 422 }
    )
  }

  // Mark player as dropped
  const { error: dropError } = await admin
    .from('room_players')
    .update({ status: 'dropped' })
    .eq('room_id', room.id)
    .eq('user_id', user.id)

  if (dropError) {
    console.error('[POST /api/rooms/[code]/leave] Drop error:', dropError)
    return NextResponse.json({ error: 'Failed to leave room' }, { status: 500 })
  }

  // If the leaver was the host, transfer host to a random remaining active player
  if (room.host_id === user.id) {
    const { data: remaining } = await admin
      .from('room_players')
      .select('user_id')
      .eq('room_id', room.id)
      .eq('status', 'active')

    if (remaining && remaining.length > 0) {
      const newHost = remaining[Math.floor(Math.random() * remaining.length)]
      await admin
        .from('rooms')
        .update({ host_id: newHost.user_id })
        .eq('id', room.id)
    } else {
      // No one left — cancel the room
      await admin
        .from('rooms')
        .update({ status: 'cancelled' })
        .eq('id', room.id)
    }
  }

  return NextResponse.json({ ok: true }, { status: 200 })
}
