'use client'

import { useEffect, useState } from 'react'
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

  useEffect(() => {
    const supabase = createClient()

    const channel = supabase
      .channel(`game:${gameId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'rounds', filter: `game_id=eq.${gameId}` },
        (payload) => {
          setRound(payload.new as Round)
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'bids' },
        (payload) => {
          const bid = payload.new as Bid
          // Only append if it belongs to the current round
          setBids((prev) => {
            if (round && bid.player_id && prev.every((b) => b.player_id !== bid.player_id)) {
              return [...prev, bid]
            }
            return prev
          })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [gameId, round])

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
