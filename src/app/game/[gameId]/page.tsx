import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { GameShell } from './GameShell'

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

  // Fetch current round
  const { data: round } = await admin
    .from('rounds')
    .select('id, round_number, hand_size, trump_suit, trump_card_value, status, current_player_id')
    .eq('game_id', gameId)
    .order('round_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  // Fetch players in seat order with display names
  const { data: players } = await admin
    .from('room_players')
    .select('user_id, seat_order, profiles(display_name)')
    .eq('room_id', game.room_id)
    .eq('status', 'active')
    .order('seat_order', { ascending: true })

  // Fetch existing bids for current round
  const { data: bids } = round
    ? await admin
        .from('bids')
        .select('player_id, amount')
        .eq('round_id', round.id)
    : { data: [] }

  return (
    <GameShell
      gameId={gameId}
      userId={user.id}
      initialRound={round ?? null}
      initialBids={bids ?? []}
      players={
        (players ?? []).map((p) => ({
          userId: p.user_id,
          seatOrder: p.seat_order ?? 0,
          displayName: (p.profiles as { display_name: string } | null)?.display_name ?? 'Player',
        }))
      }
    />
  )
}
