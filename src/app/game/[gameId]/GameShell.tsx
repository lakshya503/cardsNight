'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { BiddingPanel } from './BiddingPanel'
import { TrickPanel } from './TrickPanel'
import { Scoreboard } from './Scoreboard'
import type { Card, Suit, CardValue } from '@/lib/game/types'

const SUIT_SYMBOL: Record<string, string> = {
  hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠',
}
const SUIT_COLOR: Record<string, string> = {
  hearts: 'text-red-500', diamonds: 'text-red-500',
  clubs: 'text-slate-900', spades: 'text-slate-900',
}

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
  initialTricksWon: Record<string, number>
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
  initialTricksWon,
  players,
}: Props) {
  const router = useRouter()

  const [round, setRound] = useState<Round | null>(initialRound)
  const [bids, setBids] = useState<Bid[]>(initialBids)
  const [hand, setHand] = useState<Card[]>(initialHand)
  const [currentTrick, setCurrentTrick] = useState<Trick | null>(initialCurrentTrick)
  const [trickCards, setTrickCards] = useState<TrickCardDisplay[]>(initialTrickCards)
  const [cumulativeScores, setCumulativeScores] = useState<Record<string, number>>(initialCumulativeScores)
  const [tricksWon, setTricksWon] = useState<Record<string, number>>(initialTricksWon)

  const roundRef = useRef<Round | null>(initialRound)
  const currentTrickRef = useRef<Trick | null>(initialCurrentTrick)

  useEffect(() => { roundRef.current = round }, [round])
  useEffect(() => { currentTrickRef.current = currentTrick }, [currentTrick])

  const playerMap = Object.fromEntries(players.map((p) => [p.userId, p]))
  const me = playerMap[userId]
  const opponents = players.filter((p) => p.userId !== userId)

  useEffect(() => {
    const supabase = createClient()

    const channel = supabase
      .channel(`game:${gameId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` },
        (payload) => {
          if ((payload.new as { status: string }).status === 'finished') {
            router.push(`/game/${gameId}/results`)
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'rounds', filter: `game_id=eq.${gameId}` },
        (payload) => {
          const updated = payload.new as Round
          if (updated.id !== roundRef.current?.id) {
            setBids([])
            setTrickCards([])
            setCurrentTrick(null)
            setHand([])
            setTricksWon({})
          }
          setRound(updated)
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'rounds', filter: `game_id=eq.${gameId}` },
        () => { router.refresh() }
      )
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
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'tricks' },
        (payload) => {
          const trick = payload.new as Trick
          if (trick.id === currentTrickRef.current?.id) {
            setCurrentTrick(trick)
            if (trick.winner_id) {
              setTricksWon((prev) => ({
                ...prev,
                [trick.winner_id!]: (prev[trick.winner_id!] ?? 0) + 1,
              }))
            }
          }
        }
      )
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

    return () => { supabase.removeChannel(channel) }
  }, [gameId, playerMap, router])

  function handleCardPlayed(card: Card) {
    setHand((prev) => prev.filter((c) => !(c.suit === card.suit && c.value === card.value)))
    setTrickCards((prev) =>
      prev.some((c) => c.playerId === userId)
        ? prev
        : [...prev, {
            playerId: userId,
            displayName: me?.displayName ?? 'You',
            suit: card.suit,
            value: card.value,
          }]
    )
  }

  const isMyTurn = round?.current_player_id === userId
  const isBidding = round?.status === 'bidding'
  const isPlaying = round?.status === 'playing'
  const hasBid = bids.some((b) => b.player_id === userId)
  const myBid = bids.find((b) => b.player_id === userId)?.amount

  const currentPlayerName = round?.current_player_id
    ? (playerMap[round.current_player_id]?.displayName ?? 'Unknown')
    : null

  // Central status message visible to everyone
  let statusMessage = ''
  if (isBidding) {
    if (isMyTurn && !hasBid) statusMessage = 'Your turn to place a bid'
    else if (hasBid) statusMessage = `Waiting for ${currentPlayerName} to bid…`
    else statusMessage = `${currentPlayerName} is choosing their bid…`
  } else if (isPlaying) {
    if (isMyTurn) statusMessage = 'Your turn to play a card'
    else statusMessage = `${currentPlayerName}'s turn to play…`
  } else if (round?.status === 'complete') {
    statusMessage = 'Round complete — starting next round…'
  }

  const scoreboardData = players.map((p) => ({
    userId: p.userId,
    displayName: p.displayName,
    total: cumulativeScores[p.userId] ?? 0,
    currentBid: bids.find((b) => b.player_id === p.userId)?.amount,
    tricksWon: tricksWon[p.userId] ?? 0,
  }))

  function getBidLabel(playerId: string) {
    const bid = bids.find((b) => b.player_id === playerId)
    if (bid !== undefined) return `bid ${bid.amount}`
    if (isBidding && round?.current_player_id === playerId) return 'bidding…'
    return null
  }

  return (
    <main className="min-h-screen bg-slate-900 text-white flex flex-col">

      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
        <span className="font-semibold">Round {round?.round_number ?? '—'}</span>
        <span className="text-sm text-slate-400">
          {round ? `${round.hand_size} card${round.hand_size !== 1 ? 's' : ''} this round` : ''}
        </span>
      </header>

      {/* Game board — three rows: opponent / table / you */}
      <div className="flex-1 flex flex-col max-w-lg mx-auto w-full px-4 py-4 gap-4">

        {/* Scoreboard */}
        <Scoreboard scores={scoreboardData} currentRoundNumber={round?.round_number ?? 1} isPlaying={isPlaying} />

        {/* ── Opponent row (top) ─────────────────────────── */}
        <div className="flex justify-center gap-4">
          {opponents.map((p) => {
            const label = getBidLabel(p.userId)
            return (
              <div
                key={p.userId}
                className="flex flex-col items-center gap-1 px-4 py-3 bg-slate-800 rounded-xl min-w-[100px]"
              >
                <div className="w-9 h-9 rounded-full bg-slate-600 flex items-center justify-center text-sm font-bold">
                  {p.displayName[0].toUpperCase()}
                </div>
                <span className="text-sm font-medium">{p.displayName}</span>
                {label && <span className="text-xs text-slate-400">{label}</span>}
              </div>
            )
          })}
        </div>

        {/* ── Table center ──────────────────────────────── */}
        <div className="flex flex-col items-center gap-4">

          {/* Trump card */}
          {round && (
            <div className="flex flex-col items-center gap-1">
              <p className="text-xs text-slate-400 uppercase tracking-wide">Trump</p>
              <div
                className={`w-20 h-28 rounded-xl bg-white shadow-lg flex flex-col items-center justify-center gap-1 select-none ${SUIT_COLOR[round.trump_suit]}`}
              >
                <span className="text-lg font-bold leading-none">{round.trump_card_value}</span>
                <span className="text-3xl leading-none">{SUIT_SYMBOL[round.trump_suit]}</span>
              </div>
            </div>
          )}

          {/* Status message */}
          {statusMessage && (
            <p className="text-slate-300 text-sm text-center px-4 py-2 bg-slate-800 rounded-lg">
              {statusMessage}
            </p>
          )}

          {/* Current trick cards (during playing) */}
          {isPlaying && currentTrick && trickCards.length > 0 && (
            <div className="flex gap-3">
              {trickCards.map((tc) => (
                <div key={tc.playerId} className="flex flex-col items-center gap-1">
                  <div className="relative w-20 h-28 rounded-xl bg-white shadow-md flex flex-col p-1.5 select-none">
                    <span className={`text-sm font-bold leading-none ${SUIT_COLOR[tc.suit]}`}>{tc.value}</span>
                    <div className={`flex-1 flex items-center justify-center text-4xl ${SUIT_COLOR[tc.suit]}`}>
                      {SUIT_SYMBOL[tc.suit]}
                    </div>
                  </div>
                  <span className="text-xs text-slate-400">{tc.displayName}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Your row (bottom) ─────────────────────────── */}
        <div className="flex flex-col gap-3">

          {/* Your identity + bid status */}
          <div className="flex items-center gap-2 justify-center">
            <span className="text-sm font-medium">{me?.displayName ?? 'You'}</span>
            {myBid !== undefined && (
              <span className="text-xs text-slate-400 bg-slate-800 px-2 py-0.5 rounded-full">
                bid {myBid}
              </span>
            )}
          </div>

          {/* Your hand — visible during both bidding and playing */}
          {hand.length > 0 && (
            <div>
              <p className="text-xs text-slate-400 mb-2 text-center">Your hand</p>
              {isPlaying && currentTrick ? (
                // Clickable hand inside TrickPanel during play phase
                <TrickPanel
                  gameId={gameId}
                  round={round!}
                  hand={hand}
                  trickCards={trickCards}
                  isMyTurn={isMyTurn}
                  currentPlayerName={currentPlayerName}
                  onCardPlayed={handleCardPlayed}
                  ledSuit={(currentTrick?.led_suit ?? null) as Suit | null}
                  handOnly
                />
              ) : (
                // Read-only hand during bidding
                <div className="flex flex-wrap justify-center gap-2">
                  {hand.map((card) => (
                    <div
                      key={`${card.suit}:${card.value}`}
                      className="relative w-20 h-28 rounded-xl bg-white shadow-md flex flex-col p-1.5 select-none"
                    >
                      <span className={`text-sm font-bold leading-none ${SUIT_COLOR[card.suit]}`}>{card.value}</span>
                      <div className={`flex-1 flex items-center justify-center text-4xl ${SUIT_COLOR[card.suit]}`}>
                        {SUIT_SYMBOL[card.suit]}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Bidding action */}
          {isBidding && (
            <div data-testid="bidding-panel">
              {isMyTurn && !hasBid ? (
                <BiddingPanel
                  gameId={gameId}
                  round={round!}
                  existingBids={bids}
                  playerCount={players.length}
                />
              ) : null}
            </div>
          )}

          {/* Playing action — handled inside TrickPanel above */}
          {isPlaying && !currentTrick && (
            <div data-testid="trick-panel">
              <div className="p-4 bg-slate-800 rounded-lg text-slate-400 text-center text-sm">
                Starting trick…
              </div>
            </div>
          )}
          {isPlaying && currentTrick && (
            <div data-testid="trick-panel" />
          )}
        </div>

        {round?.status === 'complete' && (
          <div data-testid="round-complete" className="p-4 bg-slate-800 rounded-lg text-slate-300 text-center">
            Round complete — starting next round…
          </div>
        )}

      </div>
    </main>
  )
}
