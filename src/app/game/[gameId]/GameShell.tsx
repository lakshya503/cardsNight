'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { BiddingPanel } from './BiddingPanel'
import { TrickPanel } from './TrickPanel'
import type { Card, Suit, CardValue } from '@/lib/game/types'

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

interface TrickCardDisplay {
  playerId: string
  displayName: string
  suit: string
  value: string
}

interface Trick {
  id: string
  round_id?: string
  trick_number: number
  led_suit: string | null
  winner_id: string | null
}

interface Props {
  gameId: string
  userId: string
  initialRound: Round | null
  initialBids: Bid[]
  initialHand: Card[]
  initialCurrentTrick: Trick | null
  initialTrickCards: TrickCardDisplay[]
  players: Player[]
}

export function GameShell({
  gameId,
  userId,
  initialRound,
  initialBids,
  initialHand,
  initialCurrentTrick,
  initialTrickCards,
  players,
}: Props) {
  const [round, setRound] = useState<Round | null>(initialRound)
  const [bids, setBids] = useState<Bid[]>(initialBids)
  const [hand, setHand] = useState<Card[]>(initialHand)
  const [currentTrick, setCurrentTrick] = useState<Trick | null>(initialCurrentTrick)
  const [trickCards, setTrickCards] = useState<TrickCardDisplay[]>(initialTrickCards)

  const roundRef = useRef<Round | null>(initialRound)
  const currentTrickRef = useRef<Trick | null>(initialCurrentTrick)

  useEffect(() => { roundRef.current = round }, [round])
  useEffect(() => { currentTrickRef.current = currentTrick }, [currentTrick])

  const playerMap = Object.fromEntries(players.map((p) => [p.userId, p]))

  useEffect(() => {
    const supabase = createClient()

    const channel = supabase
      .channel(`game:${gameId}`)
      // Round updates: status changes, current_player_id advances
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'rounds', filter: `game_id=eq.${gameId}` },
        (payload) => {
          const updated = payload.new as Round
          if (updated.id !== roundRef.current?.id) {
            // New round started — clear bid and trick state
            setBids([])
            setTrickCards([])
            setCurrentTrick(null)
          }
          setRound(updated)
        }
      )
      // Bids: new bid placed
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'bids' },
        (payload) => {
          const bid = payload.new as Bid & { round_id: string }
          if (bid.round_id !== roundRef.current?.id) return
          setBids((prev) =>
            prev.some((b) => b.player_id === bid.player_id) ? prev : [...prev, bid]
          )
        }
      )
      // Tricks INSERT: a new trick has started
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'tricks' },
        (payload) => {
          const trick = payload.new as Trick
          if (trick.round_id !== roundRef.current?.id) return
          setCurrentTrick(trick)
          setTrickCards([])
        }
      )
      // Tricks UPDATE: trick completed (winner set) or led_suit set
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'tricks' },
        (payload) => {
          const trick = payload.new as Trick
          if (trick.id === currentTrickRef.current?.id) {
            setCurrentTrick(trick)
          }
        }
      )
      // trick_cards INSERT: a card was played in the current trick
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'trick_cards' },
        (payload) => {
          const tc = payload.new as { trick_id: string; player_id: string; suit: string; value: string }
          if (tc.trick_id !== currentTrickRef.current?.id) return
          const displayName = playerMap[tc.player_id]?.displayName ?? 'Player'
          setTrickCards((prev) =>
            prev.some((c) => c.playerId === tc.player_id)
              ? prev
              : [...prev, { playerId: tc.player_id, displayName, suit: tc.suit, value: tc.value }]
          )
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [gameId, playerMap]) // playerMap is stable (computed from props that never change)

  function handleCardPlayed(card: Card) {
    // Optimistically remove the card from hand
    setHand((prev) => prev.filter((c) => !(c.suit === card.suit && c.value === card.value)))
    // Optimistically add to trickCards
    setTrickCards((prev) =>
      prev.some((c) => c.playerId === userId)
        ? prev
        : [...prev, {
            playerId: userId,
            displayName: playerMap[userId]?.displayName ?? 'You',
            suit: card.suit,
            value: card.value,
          }]
    )
  }

  const isMyTurn = round?.current_player_id === userId
  const isBidding = round?.status === 'bidding'
  const isPlaying = round?.status === 'playing'
  const hasBid = bids.some((b) => b.player_id === userId)

  const currentPlayerName = round?.current_player_id
    ? (playerMap[round.current_player_id]?.displayName ?? 'Unknown')
    : null

  return (
    <main className="min-h-screen bg-slate-900 text-white p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-fraunces">Round {round?.round_number ?? '—'}</h1>
          {round && (
            <div className="text-right">
              <p className="text-xs text-slate-400">Trump</p>
              <p className="font-bold capitalize">{round.trump_card_value} of {round.trump_suit}</p>
            </div>
          )}
        </div>

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
                  : `Waiting for ${currentPlayerName} to bid…`}
              </div>
            )}
          </div>
        )}

        {isPlaying && (
          <div data-testid="trick-panel">
            {currentTrick ? (
              <TrickPanel
                gameId={gameId}
                round={round!}
                hand={hand}
                trickCards={trickCards}
                players={players}
                userId={userId}
                isMyTurn={isMyTurn}
                currentPlayerName={currentPlayerName}
                onCardPlayed={handleCardPlayed}
              />
            ) : (
              <div className="p-4 bg-slate-800 rounded-lg text-slate-400">
                Starting trick…
              </div>
            )}
          </div>
        )}

        {round?.status === 'scoring' && (
          <div data-testid="scoring-phase" className="p-4 bg-slate-800 rounded-lg text-slate-300">
            Round complete — scoring in progress…
          </div>
        )}
      </div>
    </main>
  )
}
