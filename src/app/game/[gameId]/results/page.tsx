import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { ResultsPanel } from './ResultsPanel'

interface PageProps {
  params: Promise<{ gameId: string }>
}

export default async function ResultsPage({ params }: PageProps) {
  const { gameId } = await params
  const supabase = await createClient()
  const admin = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const { data: game } = await admin
    .from('games')
    .select('id, status, room_id')
    .eq('id', gameId)
    .maybeSingle()

  if (!game) redirect('/')

  const { data: roomPlayer } = await admin
    .from('room_players')
    .select('id')
    .eq('room_id', game.room_id)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle()

  if (!roomPlayer) redirect('/')

  const { data: results } = await admin
    .from('game_results')
    .select('player_id, placement, result, total_score, profiles(display_name)')
    .eq('game_id', gameId)
    .order('placement', { ascending: true })

  const myResult = results?.find((r) => r.player_id === user.id)
  const isWinner = myResult?.result === 'win'

  const normalised = (results ?? []).map((r) => ({
    player_id: r.player_id,
    placement: r.placement,
    result: r.result,
    total_score: r.total_score,
    display_name: (r.profiles as { display_name: string } | null)?.display_name ?? 'Player',
  }))

  return (
    <main className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-6">
      <ResultsPanel
        results={normalised}
        currentUserId={user.id}
        isWinner={isWinner}
      />
    </main>
  )
}
