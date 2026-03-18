'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { BiddingPanel } from './BiddingPanel'

interface Player {
  userId: string
  seatOrder: number
  displayName: string
}

interface Round {
  id: string
  round_number: number
  hand_size: number
  trump_suit: string
  trump_card_value: string
  status: string
  current_player_id: string | null
}

interface Bid {
  player_id: string
  amount: number
}

interface Props {
  gameId: string
  userId: string
  initialRound: Round | null
  initialBids: Bid[]
  players: Player[]
}

export function GameShell({ gameId, userId, initialRound, initialBids, players }: Props) {
  const [round, setRound] = useState<Round | null>(initialRound)
  const [bids, setBids] = useState<Bid[]>(initialBids)

  // Ref so the bid INSERT handler always sees the current round.id
  // without needing round in the channel's useEffect deps (which would
  // cause the channel to tear down and recreate on every round update).
  const roundRef = useRef<Round | null>(initialRound)
  useEffect(() => { roundRef.current = round }, [round])

  useEffect(() => {
    const supabase = createClient()

    const channel = supabase
      .channel(`game:${gameId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'rounds', filter: `game_id=eq.${gameId}` },
        (payload) => {
          setRound(payload.new as Round)
          // Round transition clears stale bids (e.g. new round starts)
          if ((payload.new as Round).id !== roundRef.current?.id) {
            setBids([])
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'bids' },
        (payload) => {
          const bid = payload.new as Bid & { round_id: string }
          // Ignore bids from other rounds
          if (bid.round_id !== roundRef.current?.id) return
          setBids((prev) =>
            prev.some((b) => b.player_id === bid.player_id) ? prev : [...prev, bid]
          )
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [gameId]) // gameId never changes; no need to re-subscribe on round updates

  const isMyTurn = round?.current_player_id === userId
  const isBidding = round?.status === 'bidding'
  const hasBid = bids.some((b) => b.player_id === userId)

  const playerMap = Object.fromEntries(players.map((p) => [p.userId, p]))
  const currentBidderName = round?.current_player_id
    ? (playerMap[round.current_player_id]?.displayName ?? 'Unknown')
    : null

  return (
    <main className="min-h-screen bg-slate-900 text-white p-6">
      <h1 className="text-2xl font-fraunces mb-6">Round {round?.round_number ?? '—'}</h1>

      {round && (
        <div className="mb-6 p-4 bg-slate-800 rounded-lg">
          <p className="text-sm text-slate-400">Trump</p>
          <p className="text-lg font-bold capitalize">
            {round.trump_card_value} of {round.trump_suit}
          </p>
        </div>
      )}

      {isBidding && (
        <div data-testid="bidding-panel">
          {isMyTurn && !hasBid ? (
            <BiddingPanel
              gameId={gameId}
              round={round!}
              existingBids={bids}
              playerCount={players.length}
            />
          ) : (
            <div className="p-4 bg-slate-800 rounded-lg text-slate-400">
              {hasBid
                ? 'Waiting for other players to bid…'
                : `Waiting for ${currentBidderName} to bid…`}
            </div>
          )}
        </div>
      )}

      {round?.status === 'playing' && (
        <div data-testid="playing-phase" className="p-4 bg-slate-800 rounded-lg text-slate-300">
          Playing phase — Slice 4
        </div>
      )}
    </main>
  )
}
