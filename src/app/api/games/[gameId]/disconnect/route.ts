import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse, type NextRequest } from 'next/server'

interface RouteContext {
  params: Promise<{ gameId: string }>
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { gameId } = await params
  const supabase = await createClient()
  const admin = createAdminClient()

  // Auth
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Parse body
  let disconnectedUserId: string
  try {
    const body = await request.json()
    if (!body.disconnectedUserId || typeof body.disconnectedUserId !== 'string') throw new Error()
    disconnectedUserId = body.disconnectedUserId
  } catch {
    return NextResponse.json({ error: 'disconnectedUserId is required' }, { status: 400 })
  }

  // A player cannot report themselves — self-disconnection is handled by Presence cleanup
  if (disconnectedUserId === user.id) {
    return NextResponse.json({ error: 'Cannot report yourself as disconnected' }, { status: 400 })
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

  // Verify caller is an active player in this game
  const { data: callerPlayer } = await admin
    .from('room_players')
    .select('id')
    .eq('room_id', game.room_id)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle()

  if (!callerPlayer) {
    return NextResponse.json({ error: 'Not a player in this game' }, { status: 403 })
  }

  // Conditionally update the disconnected player — only if still 'active' (idempotent)
  const { data: updated, error: updateError } = await admin
    .from('room_players')
    .update({ status: 'disconnected', disconnected_at: new Date().toISOString() })
    .eq('room_id', game.room_id)
    .eq('user_id', disconnectedUserId)
    .eq('status', 'active')
    .select('id')

  if (updateError) {
    console.error('[disconnect] UPDATE error:', updateError)
    return NextResponse.json({ error: 'Failed to record disconnection' }, { status: 500 })
  }

  if (!updated || updated.length === 0) {
    return NextResponse.json({ status: 'already_disconnected' }, { status: 200 })
  }

  return NextResponse.json({ status: 'disconnected' }, { status: 200 })
}
