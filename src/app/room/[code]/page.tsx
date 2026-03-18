import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import WaitingRoom from './WaitingRoom'

interface PageProps {
  params: Promise<{ code: string }>
}

export default async function RoomPage({ params }: PageProps) {
  const { code } = await params
  const upperCode = code.toUpperCase()

  const supabase = await createClient()
  const admin = createAdminClient()

  // Auth check
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/sign-in?next=/room/${upperCode}`)

  // Fetch room (user client — rooms RLS is permissive for authenticated users)
  const { data: room } = await supabase
    .from('rooms')
    .select('id, code, host_id, status, max_players, turn_timer_seconds, game_type, expires_at')
    .eq('code', upperCode)
    .neq('status', 'cancelled')
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()

  if (!room) redirect('/?toast=room_invalid')

  // Rooms that are finished redirect home too
  if (room.status === 'finished') redirect('/?toast=room_invalid')

  // Auto-join: check membership via admin client (bypasses RLS)
  const { data: membership } = await admin
    .from('room_players')
    .select('id, status')
    .eq('room_id', room.id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (membership?.status === 'dropped') {
    // Player previously left — re-activate them if the game hasn't started
    if (room.status === 'in_progress') redirect('/?toast=room_in_progress')

    const { count } = await admin
      .from('room_players')
      .select('id', { count: 'exact', head: true })
      .eq('room_id', room.id)
      .neq('status', 'dropped')

    if ((count ?? 0) >= room.max_players) redirect('/?toast=room_full')

    await admin
      .from('room_players')
      .update({ status: 'active' })
      .eq('id', membership.id)
  } else if (!membership) {
    if (room.status === 'in_progress') redirect('/?toast=room_in_progress')

    // Check capacity
    const { count } = await admin
      .from('room_players')
      .select('id', { count: 'exact', head: true })
      .eq('room_id', room.id)
      .neq('status', 'dropped')

    if ((count ?? 0) >= room.max_players) redirect('/?toast=room_full')

    // Join the room
    const { error: joinError } = await admin
      .from('room_players')
      .insert({ room_id: room.id, user_id: user.id, status: 'active' })

    if (joinError) redirect('/?toast=room_invalid')
  }

  // Fetch all players with profiles
  const { data: players } = await admin
    .from('room_players')
    .select(`
      user_id,
      status,
      joined_at,
      profiles (
        display_name,
        avatar_url
      )
    `)
    .eq('room_id', room.id)
    .neq('status', 'dropped')
    .order('joined_at', { ascending: true })

  return (
    <WaitingRoom
      room={{
        id: room.id,
        code: room.code,
        hostId: room.host_id,
        status: room.status,
        maxPlayers: room.max_players,
        turnTimerSeconds: room.turn_timer_seconds,
        gameType: room.game_type,
      }}
      initialPlayers={(players ?? []).map((p) => ({
        userId: p.user_id,
        status: p.status,
        joinedAt: p.joined_at,
        displayName: (p.profiles as unknown as { display_name: string; avatar_url: string | null } | null)?.display_name ?? 'Player',
        avatarUrl: (p.profiles as unknown as { display_name: string; avatar_url: string | null } | null)?.avatar_url ?? null,
      }))}
      currentUserId={user.id}
    />
  )
}
