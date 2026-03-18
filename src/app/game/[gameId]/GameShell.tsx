'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { BiddingPanel } from './BiddingPanel'
import { TrickPanel } from './TrickPanel'
import { Scoreboard } from './Scoreboard'
import type { Card, Suit, CardValue } from '@/lib/game/types'

interface Player {
  userId: string
  seatOrder: number
  displayName: string
}

interface Round {
  id: string
  round_id?: string
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

interface RoundScore {
  player_id: string
  score: number
}

interface Props {
  gameId: string
  userId: string
  initialRound: Round | null
  initialBids: Bid[]
  initialHand: Card[]
  initialCurrentTrick: Trick | null
  initialTrickCards: TrickCardDisplay[]
  initialCumulativeScores: Record<string, number>
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
  initialCumulativeScores,
  players,
}: Props) {
  const router = useRouter()

  const [round, setRound] = useState<Round | null>(initialRound)
  const [bids, setBids] = useState<Bid[]>(initialBids)
  const [hand, setHand] = useState<Card[]>(initialHand)
  const [currentTrick, setCurrentTrick] = useState<Trick | null>(initialCurrentTrick)
  const [trickCards, setTrickCards] = useState<TrickCardDisplay[]>(initialTrickCards)
  const [cumulativeScores, setCumulativeScores] = useState<Record<string, number>>(initialCumulativeScores)

  const roundRef = useRef<Round | null>(initialRound)
  const currentTrickRef = useRef<Trick | null>(initialCurrentTrick)

  useEffect(() => { roundRef.current = round }, [round])
  useEffect(() => { currentTrickRef.current = currentTrick }, [currentTrick])

  const playerMap = Object.fromEntries(players.map((p) => [p.userId, p]))

  useEffect(() => {
    const supabase = createClient()

    const channel = supabase
      .channel(`game:${gameId}`)
      // Game UPDATE: navigate to results when game finishes
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` },
        (payload) => {
          if ((payload.new as { status: string }).status === 'finished') {
            router.push(`/game/${gameId}/results`)
          }
        }
      )
      // Round UPDATE: status + turn changes; new round resets local state
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'rounds', filter: `game_id=eq.${gameId}` },
        (payload) => {
          const updated = payload.new as Round
          if (updated.id !== roundRef.current?.id) {
            // New round — fetch fresh hand from server since we can't derive it client-side
            setBids([])
            setTrickCards([])
            setCurrentTrick(null)
            setHand([]) // page will reload on navigation; handled by round INSERT subscription
          }
          setRound(updated)
        }
      )
      // New round INSERT: page refresh pulls the new round's hand server-side.
      // We trigger a router refresh so Next.js re-runs the server component.
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'rounds', filter: `game_id=eq.${gameId}` },
        () => {
          router.refresh()
        }
      )
      // Bids INSERT
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
      // Tricks INSERT: new trick started
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
      // Tricks UPDATE: led_suit set or winner determined
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
      // trick_cards INSERT: a card was played
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
      // round_scores INSERT: a round has been scored — update cumulative totals
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'round_scores' },
        (payload) => {
          const rs = payload.new as RoundScore
          setCumulativeScores((prev) => ({
            ...prev,
            [rs.player_id]: (prev[rs.player_id] ?? 0) + rs.score,
          }))
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [gameId, playerMap, router])

  function handleCardPlayed(card: Card) {
    setHand((prev) => prev.filter((c) => !(c.suit === card.suit && c.value === card.value)))
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

  const scoreboardData = players.map((p) => ({
    userId: p.userId,
    displayName: p.displayName,
    total: cumulativeScores[p.userId] ?? 0,
    currentBid: bids.find((b) => b.player_id === p.userId)?.amount,
  }))

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

        <Scoreboard scores={scoreboardData} currentRoundNumber={round?.round_number ?? 1} />

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

        {round?.status === 'complete' && (
          <div data-testid="round-complete" className="p-4 bg-slate-800 rounded-lg text-slate-300 text-center">
            Round complete — starting next round…
          </div>
        )}
      </div>
    </main>
  )
}
