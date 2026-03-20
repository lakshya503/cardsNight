'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { createClient } from '@/lib/supabase/client'
import { BiddingPanel } from './BiddingPanel'
import { TrickPanel } from './TrickPanel'
import { Scoreboard } from './Scoreboard'
import type { Card, Suit, CardValue } from '@/lib/game/types'

function TrickProgress({ won, bid }: { won: number; bid: number }) {
  if (bid === 0) {
    return (
      <span className={`text-xs font-medium ${won === 0 ? 'text-emerald-400' : 'text-red-400'}`}>
        {won === 0 ? '0 bid ✓' : `${won} won (busted)`}
      </span>
    )
  }
  const pct = Math.min((won / bid) * 100, 100)
  const over = won > bid
  return (
    <div className="w-full flex flex-col items-center gap-0.5">
      <span className="text-xs tabular-nums" style={{ color: 'var(--color-text-muted)' }}>{won}/{bid}</span>
      <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-surface-raised)' }}>
        <div
          className={`h-full rounded-full transition-all duration-500 ${over ? 'bg-amber-400' : 'bg-emerald-400'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

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
  const [trickAnimation, setTrickAnimation] = useState<'up' | 'down' | null>(null)
  // Snapshot captured at round-complete time; stays frozen while the overlay is shown
  const [summaryRoundNumber, setSummaryRoundNumber] = useState<number | null>(null)
  const [summaryTricksWon, setSummaryTricksWon] = useState<Record<string, number>>({})
  const [summaryBids, setSummaryBids] = useState<Bid[]>([])
  const [summaryRoundScores, setSummaryRoundScores] = useState<Record<string, number>>({})
  const [showRoundSummary, setShowRoundSummary] = useState(false)

  const roundRef = useRef<Round | null>(initialRound)
  const currentTrickRef = useRef<Trick | null>(initialCurrentTrick)
  const trickAnimationRef = useRef<'up' | 'down' | null>(null)
  // Refs so Realtime handlers can snapshot current state without stale closures
  const tricksWonRef = useRef<Record<string, number>>(initialTricksWon)
  const bidsRef = useRef<Bid[]>(initialBids)

  useEffect(() => { roundRef.current = round }, [round])
  useEffect(() => { currentTrickRef.current = currentTrick }, [currentTrick])
  useEffect(() => { tricksWonRef.current = tricksWon }, [tricksWon])
  useEffect(() => { bidsRef.current = bids }, [bids])
  // Note: trickAnimationRef is managed manually in the tricks UPDATE handler
  // to gate the INSERT handler immediately (before React re-renders trickAnimation state)

  // Sync all client state when server provides a new round (after router.refresh()).
  // useState initial values don't update on prop changes, so we sync explicitly.
  // We intentionally do NOT reset showRoundSummary here — the overlay stays visible
  // until the user taps to dismiss, even after the new round's state has loaded.
  // Also re-sync when current_player_id or status changes so that polling-triggered
  // refreshes (which fire router.refresh() on drift) actually update the UI.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setRound(initialRound)
    setBids(initialBids)
    setHand(initialHand)
    setCurrentTrick(initialCurrentTrick)
    setTrickCards(initialTrickCards)
    setTricksWon(initialTricksWon)
    setTrickAnimation(null)
    roundRef.current = initialRound
    currentTrickRef.current = initialCurrentTrick
  }, [initialRound?.id, initialRound?.current_player_id, initialRound?.status])

  // useMemo is critical here: playerMap must be a stable reference so it doesn't
  // appear as changed on every render and tear down the Realtime channel.
  const playerMap = useMemo(
    () => Object.fromEntries(players.map((p) => [p.userId, p])),
    [players]
  )
  const playerMapRef = useRef(playerMap)
  useEffect(() => { playerMapRef.current = playerMap }, [playerMap])

  const me = playerMap[userId]
  const opponents = players.filter((p) => p.userId !== userId)

  useEffect(() => {
    const supabase = createClient()
    const rt = process.env.NODE_ENV === 'development'
      ? (...args: unknown[]) => console.log('[RT]', ...args)
      : () => {}

    let active = true
    let currentChannel: ReturnType<typeof supabase.channel> | null = null

    function setup() {
      const channel = supabase
        .channel(`game:${gameId}`)
        .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` },
        (payload) => {
          const status = (payload.new as { status: string }).status
          rt('games UPDATE', { status })
          if (status === 'finished') {
            router.push(`/game/${gameId}/results`)
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'rounds', filter: `game_id=eq.${gameId}` },
        (payload) => {
          const updated = payload.new as Round
          rt('rounds UPDATE', { id: updated.id, status: updated.status, currentRoundId: roundRef.current?.id })
          if (updated.id !== roundRef.current?.id) {
            rt('rounds UPDATE → new round, resetting per-round state')
            setBids([])
            setTrickCards([])
            setCurrentTrick(null)
            setHand([])
            setTricksWon({})
          } else if (updated.status === 'complete' && roundRef.current?.status !== 'complete') {
            rt('rounds UPDATE → round complete, showing summary')
            setSummaryRoundNumber(updated.round_number)
            setSummaryTricksWon({ ...tricksWonRef.current })
            setSummaryBids([...bidsRef.current])
            setSummaryRoundScores({})
            setShowRoundSummary(true)
          }
          setRound(updated)
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'rounds', filter: `game_id=eq.${gameId}` },
        (payload) => {
          rt('rounds INSERT → calling router.refresh()', { id: (payload.new as { id: string }).id })
          router.refresh()
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'bids' },
        (payload) => {
          const bid = payload.new as Bid & { round_id: string }
          rt('bids INSERT', { player_id: bid.player_id, amount: bid.amount, round_id: bid.round_id, currentRoundId: roundRef.current?.id })
          if (bid.round_id !== roundRef.current?.id) { rt('bids INSERT → ignored (wrong round)'); return }
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
          rt('tricks INSERT', { id: trick.id, round_id: trick.round_id, currentRoundId: roundRef.current?.id, animating: trickAnimationRef.current })
          if (trick.round_id !== roundRef.current?.id) { rt('tricks INSERT → ignored (wrong round)'); return }
          setCurrentTrick(trick)
          if (!trickAnimationRef.current) setTrickCards([])
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'tricks' },
        (payload) => {
          const trick = payload.new as Trick
          rt('tricks UPDATE', { id: trick.id, winner_id: trick.winner_id, currentTrickId: currentTrickRef.current?.id })
          if (trick.id !== currentTrickRef.current?.id) { rt('tricks UPDATE → ignored (wrong trick)'); return }
          setCurrentTrick(trick)
          if (trick.winner_id) {
            setTricksWon((prev) => ({
              ...prev,
              [trick.winner_id!]: (prev[trick.winner_id!] ?? 0) + 1,
            }))
            const direction = trick.winner_id === userId ? 'down' : 'up'
            const roundId = trick.round_id ?? roundRef.current?.id ?? ''
            trickAnimationRef.current = direction
            rt('tricks UPDATE → winner set, starting animation pause', { direction, roundId })
            setTimeout(() => {
              setTrickAnimation(direction)
              setTimeout(async () => {
                setTrickAnimation(null)
                trickAnimationRef.current = null
                setTrickCards([])
                if (roundId) {
                  const sb = createClient()
                  const { data: nextTrick } = await sb
                    .from('tricks')
                    .select('id, trick_number, led_suit, winner_id')
                    .eq('round_id', roundId)
                    .is('winner_id', null)
                    .maybeSingle()
                  rt('tricks UPDATE fallback fetch', { nextTrick })
                  if (nextTrick) {
                    setCurrentTrick(nextTrick as Trick)
                    setTrickCards([])
                  }
                }
              }, 700)
            }, 700)
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'trick_cards' },
        (payload) => {
          const tc = payload.new as { trick_id: string; player_id: string; suit: string; value: string }
          rt('trick_cards INSERT', { trick_id: tc.trick_id, player_id: tc.player_id, currentTrickId: currentTrickRef.current?.id })
          if (tc.trick_id !== currentTrickRef.current?.id) { rt('trick_cards INSERT → ignored (wrong trick)'); return }
          const displayName = playerMapRef.current[tc.player_id]?.displayName ?? 'Player'
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
          rt('round_scores INSERT', { player_id: rs.player_id, score: rs.score })
          setCumulativeScores((prev) => ({
            ...prev,
            [rs.player_id]: (prev[rs.player_id] ?? 0) + rs.score,
          }))
          setSummaryRoundScores((prev) => ({ ...prev, [rs.player_id]: rs.score }))
        }
      )
        .subscribe((status, err) => {
          rt('channel status:', status, err ?? '')
          if (!active) return
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.error('[RT] Realtime channel error, retrying in 2s', err)
            supabase.removeChannel(channel)
            setTimeout(setup, 2000)
          }
        })
      currentChannel = channel
    }

  // createBrowserClient only calls realtime.setAuth() on auth state *transitions*
  // (SIGNED_IN / TOKEN_REFRESHED). An existing cookie session on page load fires no
  // state change, so the WebSocket connects without a JWT. Supabase then evaluates
  // auth.uid() = null for every RLS policy → no events delivered even though the
  // channel shows SUBSCRIBED. Manually inject the token before subscribing.
  supabase.auth.getSession().then(({ data: { session } }) => {
    if (!active) return
    if (session?.access_token) {
      supabase.realtime.setAuth(session.access_token)
    }
    setup()
  })

  return () => {
    active = false
    if (currentChannel) supabase.removeChannel(currentChannel)
  }
  // playerMap intentionally excluded: it's stable (players don't change mid-game)
  // and was causing the channel to tear down on every state update.
  // playerMapRef gives the handler access to the latest value without re-subscribing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, router])

  // Polling fallback: if Realtime missed an event, detect state drift and refresh.
  useEffect(() => {
    const interval = setInterval(async () => {
      const supabase = createClient()
      const { data } = await supabase
        .from('rounds')
        .select('id, status, current_player_id, round_number, hand_size, trump_suit, trump_card_value')
        .eq('game_id', gameId)
        .neq('status', 'complete')
        .maybeSingle()
      if (!data) return
      const cur = roundRef.current
      if (
        !cur ||
        data.id !== cur.id ||
        data.current_player_id !== cur.current_player_id ||
        data.status !== cur.status
      ) {
        router.refresh()
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [gameId, router])

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
  }))

  function getBidLabel(playerId: string) {
    const bid = bids.find((b) => b.player_id === playerId)
    if (bid !== undefined) return `bid ${bid.amount}`
    if (isBidding && round?.current_player_id === playerId) return 'bidding…'
    return null
  }

  return (
    <main className="min-h-screen flex flex-col" style={{ backgroundColor: 'var(--color-background)', color: 'var(--color-text)' }}>

      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
        <span className="font-semibold">Round {round?.round_number ?? '—'}</span>
        <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          {round ? `${round.hand_size} card${round.hand_size !== 1 ? 's' : ''} this round` : ''}
        </span>
      </header>

      {/* Game board — three rows: opponent / table / you */}
      <div className="flex-1 flex flex-col max-w-lg mx-auto w-full px-4 py-4 gap-4">

        {/* Scoreboard */}
        <Scoreboard scores={scoreboardData} currentRoundNumber={round?.round_number ?? 1} />

        {/* ── Opponent row (top) ─────────────────────────── */}
        <div className="flex flex-wrap justify-center gap-2">
          {opponents.map((p) => {
            const label = getBidLabel(p.userId)
            return (
              <div
                key={p.userId}
                className="flex flex-col items-center gap-1 px-3 py-2 rounded-xl w-[88px]"
                style={{ backgroundColor: 'var(--color-surface)' }}
              >
                <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold" style={{ backgroundColor: '#2A2A42' }}>
                  {p.displayName[0].toUpperCase()}
                </div>
                <span className="text-sm font-medium">{p.displayName}</span>
                {label && <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{label}</span>}
                {isPlaying && bids.find((b) => b.player_id === p.userId) !== undefined && (
                  <TrickProgress
                    won={tricksWon[p.userId] ?? 0}
                    bid={bids.find((b) => b.player_id === p.userId)!.amount}
                  />
                )}
              </div>
            )
          })}
        </div>

        {/* ── Table center ──────────────────────────────── */}
        <div className="flex flex-col items-center gap-4">

          {/* Trump card */}
          {round && (
            <div className="flex flex-col items-center gap-1">
              <p className="text-xs uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>Trump</p>
              <div
                className={`w-20 h-28 rounded-xl bg-white shadow-lg flex flex-col items-center justify-center gap-1 select-none ${SUIT_COLOR[round.trump_suit]}`}
              >
                <span className="text-xl font-bold leading-none">{round.trump_card_value}</span>
                <span className="text-4xl leading-none">{SUIT_SYMBOL[round.trump_suit]}</span>
              </div>
            </div>
          )}

          {/* Status message */}
          {statusMessage && (
            <p
              className="text-sm text-center px-4 py-2.5 font-medium rounded-lg"
              style={{
                color: 'var(--color-primary)',
                border: '1px solid var(--color-primary)',
                backgroundColor: 'rgba(245, 184, 0, 0.08)',
              }}
            >
              {statusMessage}
            </p>
          )}

          {/* Current trick cards (during playing) */}
          {isPlaying && currentTrick && trickCards.length > 0 && (
            <motion.div
              className="flex flex-wrap justify-center gap-2"
              animate={
                trickAnimation === 'up'
                  ? { y: -96, opacity: 0, scale: 0.85, rotate: -3 }
                  : trickAnimation === 'down'
                  ? { y: 96, opacity: 0, scale: 0.85, rotate: 3 }
                  : { y: 0, opacity: 1, scale: 1, rotate: 0 }
              }
              transition={{ duration: 0.65, ease: [0.4, 0, 0.2, 1] }}
            >
              {trickCards.map((tc) => (
                <div key={tc.playerId} className="flex flex-col items-center gap-1">
                  {/* layoutId matches the card in TrickPanel hand — creates the fly animation
                      for the card owner. For other players, it's a simple entrance. */}
                  <motion.div
                    layoutId={`card-${tc.suit}-${tc.value}`}
                    initial={{ scale: 0.85, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 340, damping: 28 }}
                    className="relative w-20 h-28 rounded-xl bg-white shadow-md flex flex-col p-1.5 select-none"
                  >
                    <span className={`text-base font-bold leading-none ${SUIT_COLOR[tc.suit]}`}>{tc.value}</span>
                    <div className={`flex-1 flex items-center justify-center text-4xl ${SUIT_COLOR[tc.suit]}`}>
                      {SUIT_SYMBOL[tc.suit]}
                    </div>
                  </motion.div>
                  <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{tc.displayName}</span>
                </div>
              ))}
            </motion.div>
          )}
        </div>

        {/* ── Your row (bottom) ─────────────────────────── */}
        <div className="flex flex-col gap-3">

          {/* Your identity + bid status */}
          <div className="flex flex-col items-center gap-1.5">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{me?.displayName ?? 'You'}</span>
              {myBid !== undefined && !isPlaying && (
                <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text-muted)' }}>
                  bid {myBid}
                </span>
              )}
            </div>
            {myBid !== undefined && isPlaying && (
              <div className="w-32">
                <TrickProgress won={tricksWon[userId] ?? 0} bid={myBid} />
              </div>
            )}
          </div>

          {/* Your hand — visible during both bidding and playing */}
          {hand.length > 0 && (
            <div>
              <p className="text-xs mb-2 text-center" style={{ color: 'var(--color-text-muted)' }}>Your hand</p>
              {isPlaying && currentTrick ? (
                // Clickable hand inside TrickPanel during play phase
                <TrickPanel
                  gameId={gameId}
                  hand={hand}
                  trickCards={trickCards}
                  isMyTurn={isMyTurn}
                  currentPlayerName={currentPlayerName}
                  onCardPlayed={handleCardPlayed}
                  ledSuit={(currentTrick?.led_suit ?? null) as Suit | null}
                  trumpSuit={round!.trump_suit}
                  handOnly
                />
              ) : (
                // Read-only hand during bidding — layout animates reposition, no layoutId
                // (layoutId is only used during the playing phase in TrickPanel to fly cards to center)
                <div className="flex flex-wrap justify-center gap-2">
                  {hand.map((card) => (
                    <motion.div
                      key={`${card.suit}:${card.value}`}
                      layout
                      transition={{ layout: { type: 'spring', stiffness: 400, damping: 30 } }}
                      className={`relative w-20 h-28 rounded-xl bg-white flex flex-col p-1.5 select-none${round?.trump_suit === card.suit ? ' ring-2 ring-amber-400 shadow-[0_0_20px_6px_rgba(251,191,36,0.75)]' : ' shadow-md'}`}
                    >
                      <span className={`text-base font-bold leading-none ${SUIT_COLOR[card.suit]}`}>{card.value}</span>
                      <div className={`flex-1 flex items-center justify-center text-4xl ${SUIT_COLOR[card.suit]}`}>
                        {SUIT_SYMBOL[card.suit]}
                      </div>
                    </motion.div>
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
              <div className="p-4 rounded-lg text-center text-sm" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text-muted)' }}>
                Starting trick…
              </div>
            </div>
          )}
          {isPlaying && currentTrick && (
            <div data-testid="trick-panel" />
          )}
        </div>

        {round?.status === 'complete' && (
          <div data-testid="round-complete" className="p-4 rounded-lg text-center" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}>
            Round complete — starting next round…
          </div>
        )}

      </div>

      {/* ── Round summary overlay ─────────────────────────── */}
      {showRoundSummary && summaryRoundNumber !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-in fade-in duration-300"
          onClick={() => setShowRoundSummary(false)}
        >
          <div
            className="rounded-2xl shadow-2xl p-6 mx-4 w-full max-w-sm max-h-[85vh] flex flex-col animate-in slide-in-from-bottom-8 duration-300"
            style={{ backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-xl)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-center mb-1">Round {summaryRoundNumber} complete</h2>
            <p className="text-xs text-center mb-5" style={{ color: 'var(--color-text-muted)' }}>Tap anywhere to continue</p>

            <div className="space-y-3 overflow-y-auto flex-1">
              {players
                .slice()
                .sort((a, b) => (cumulativeScores[b.userId] ?? 0) - (cumulativeScores[a.userId] ?? 0))
                .map((p) => {
                  // Use snapshot data so it doesn't change as the new round loads
                  const roundScore = summaryRoundScores[p.userId] ?? 0
                  const total = cumulativeScores[p.userId] ?? 0
                  const bid = summaryBids.find((b) => b.player_id === p.userId)?.amount
                  const wonCount = summaryTricksWon[p.userId] ?? 0
                  const exactBid = bid !== undefined && wonCount === bid
                  return (
                    <div key={p.userId} className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{ backgroundColor: '#2A2A42' }}>
                          {p.displayName[0].toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{p.displayName}</p>
                          {bid !== undefined && (
                            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                              {wonCount}/{bid} tricks
                              {exactBid && <span className="ml-1 text-emerald-400">✓ exact</span>}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={`text-base font-bold tabular-nums ${roundScore > 0 ? 'text-emerald-400' : ''}`} style={roundScore === 0 ? { color: 'var(--color-text-muted)' } : {}}>
                          {roundScore > 0 ? `+${roundScore}` : '+0'}
                        </p>
                        <p className="text-xs tabular-nums" style={{ color: 'var(--color-text-muted)' }}>{total} total</p>
                      </div>
                    </div>
                  )
                })}
            </div>

            <div className="mt-5 pt-4 border-t text-center" style={{ borderColor: 'var(--color-border)' }}>
              <button
                onClick={() => setShowRoundSummary(false)}
                className="text-sm transition-colors"
                style={{ color: 'var(--color-text-muted)' }}
              >
                Continue to next round →
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
