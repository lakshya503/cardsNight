'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { createClient } from '@/lib/supabase/client'
import { BiddingPanel } from './BiddingPanel'
import { TrickPanel } from './TrickPanel'
import { Scoreboard } from './Scoreboard'
import { TurnTimer } from './TurnTimer'
import { ReconnectionBanner } from './ReconnectionBanner'
import type { Card, Suit, CardValue } from '@/lib/game/types'

function TrickProgress({ won, bid }: { won: number; bid: number }) {
  if (bid === 0) {
    if (won === 0) {
      return <span className="text-xs tabular-nums" style={{ color: 'var(--color-text-muted)' }}>nil</span>
    }
    // Busted nil — show one red dot per trick won + "nil ✗" label; avoid "X/0" fraction
    return (
      <div className="flex items-center gap-1.5">
        <div className="flex gap-0.5">
          {Array.from({ length: won }, (_, i) => (
            <div key={i} style={{ width: '10px', height: '5px', borderRadius: '2px', backgroundColor: 'var(--color-error)' }} />
          ))}
        </div>
        <span className="text-xs" style={{ color: 'var(--color-error)' }}>nil ✗</span>
      </div>
    )
  }
  const over = won > bid
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex gap-0.5">
        {Array.from({ length: bid }, (_, i) => (
          <div
            key={i}
            style={{
              width: '10px', height: '5px', borderRadius: '2px',
              backgroundColor: i < won
                ? (over ? 'var(--color-error)' : 'var(--color-success)')
                : 'var(--color-surface-raised)',
              transition: 'background-color 0.3s',
            }}
          />
        ))}
        {over && Array.from({ length: won - bid }, (_, i) => (
          <div
            key={`x-${i}`}
            style={{ width: '10px', height: '5px', borderRadius: '2px', backgroundColor: 'var(--color-error)' }}
          />
        ))}
      </div>
      <span className="text-xs tabular-nums" style={{ color: over ? 'var(--color-error)' : 'var(--color-text-muted)' }}>
        {won}/{bid}
      </span>
    </div>
  )
}

const SUIT_SYMBOL: Record<string, string> = {
  hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠',
}
const SUIT_COLOR: Record<string, string> = {
  hearts: 'text-[var(--color-suit-warm)]', diamonds: 'text-[var(--color-suit-warm)]',
  clubs: 'text-[var(--color-suit-dark)]', spades: 'text-[var(--color-suit-dark)]',
}

interface Player {
  userId: string
  seatOrder: number
  displayName: string
  avatarUrl?: string
}

interface Round {
  id: string
  round_number: number
  hand_size: number
  trump_suit: string
  trump_card_value: string
  status: string
  current_player_id: string | null
  turn_started_at: string | null
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
  turnTimerSeconds: number | null
  roomCode: string
  initialDroppedPlayers: string[]
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
  turnTimerSeconds,
  roomCode,
  initialDroppedPlayers,
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
  // disconnectedPlayers: userId → disconnectedAt ISO string
  const [leavePending, setLeavePending] = useState(false)
  const [disconnectedPlayers, setDisconnectedPlayers] = useState<Map<string, string>>(new Map())
  // droppedPlayers: userId set — players who failed to reconnect and were dropped
  const [droppedPlayers, setDroppedPlayers] = useState<Set<string>>(new Set(initialDroppedPlayers))

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
    setLeavePending(false)
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
            // Do NOT reset summaryRoundScores here — round_scores INSERTs arrive before
            // the round UPDATE, so the scores are already populated. Resetting here
            // would wipe them and cause the summary to show +0 for every player.
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

  // Presence: detect player disconnects via heartbeat LEAVE events.
  // Each client tracks its own presence; on LEAVE, the first detecting client
  // calls the disconnect endpoint (idempotent — concurrent calls no-op).
  // Peer-reporting threat model: any active player in the same room can report
  // another. The UPDATE is scoped to room_id, limiting blast radius to the game.
  useEffect(() => {
    const supabase = createClient()
    let active = true
    let presenceChannel: ReturnType<typeof supabase.channel> | null = null

    function setup() {
      if (!active) return
      const channel = supabase
        .channel(`presence:game:${gameId}`)
        .on('presence', { event: 'leave' }, ({ leftPresences }) => {
          if (!active) return
          for (const presence of leftPresences) {
            const departed = (presence as { userId?: string }).userId
            if (!departed || departed === userId) continue
            // Optimistic timestamp; overwritten with server value on success.
            // Capture the token so the fetch callback can verify it hasn't been
            // superseded by a subsequent leave event for the same player.
            const optimisticTs = new Date().toISOString()
            setDisconnectedPlayers((prev) => new Map(prev).set(departed, optimisticTs))

            const body = JSON.stringify({ disconnectedUserId: departed })
            const doFetch = () => fetch(`/api/games/${gameId}/disconnect`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body,
            })

            const applyServerTs = (serverTs: string) => {
              setDisconnectedPlayers((prev) => {
                const next = new Map(prev)
                // Only overwrite if the current value is still our optimistic timestamp.
                // A subsequent leave event may have set a newer optimistic timestamp.
                if (next.get(departed) === optimisticTs) next.set(departed, serverTs)
                return next
              })
            }

            doFetch()
              .then(async (res) => {
                if (!active) return
                if (!res.ok) throw new Error(`disconnect ${res.status}`)
                const data = await res.json() as { disconnected_at?: string }
                if (data.disconnected_at) applyServerTs(data.disconnected_at)
              })
              .catch(() => {
                if (!active) return
                doFetch()
                  .then(async (res) => {
                    if (!active) return
                    if (!res.ok) return
                    const data = await res.json() as { disconnected_at?: string }
                    if (data.disconnected_at) applyServerTs(data.disconnected_at)
                  })
                  .catch((err) => {
                    if (!active) return
                    console.error('[Presence] disconnect fetch failed after retry:', err)
                  })
              })
          }
        })
        .on('presence', { event: 'join' }, ({ newPresences }) => {
          if (!active) return
          for (const presence of newPresences) {
            const joined = (presence as { userId?: string }).userId
            if (joined && joined !== userId) {
              setDisconnectedPlayers((prev) => {
                if (!prev.has(joined)) return prev
                const next = new Map(prev)
                next.delete(joined)
                return next
              })
            }
          }
        })
      presenceChannel = channel

      channel.subscribe(async (status) => {
        if (!active) return
        if (status === 'SUBSCRIBED') {
          await channel.track({ userId })
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.error('[Presence] channel error, retrying in 2s:', status)
          supabase.removeChannel(channel)
          setTimeout(setup, 2000)
        }
      })
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!active) return
      if (session?.access_token) {
        supabase.realtime.setAuth(session.access_token)
      }
      setup()
    })

    return () => {
      active = false
      if (presenceChannel) supabase.removeChannel(presenceChannel)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- gameId is a route param (stable); userId comes from server auth (stable for session lifetime); neither changes without a full navigation
  }, [gameId, userId])

  // Polling fallback: if Realtime missed an event, detect state drift and refresh.
  useEffect(() => {
    const interval = setInterval(async () => {
      const supabase = createClient()
      const { data } = await supabase
        .from('rounds')
        .select('id, status, current_player_id, round_number, hand_size, trump_suit, trump_card_value, turn_started_at')
        .eq('game_id', gameId)
        .neq('status', 'complete')
        .maybeSingle()
      if (!data) return
      const cur = roundRef.current
      if (
        !cur ||
        data.id !== cur.id ||
        data.current_player_id !== cur.current_player_id ||
        data.status !== cur.status ||
        data.turn_started_at !== cur.turn_started_at
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
        <div className="flex flex-col leading-tight">
          <span className="font-semibold">Round {round?.round_number ?? '—'}</span>
          {roomCode && (
            <span className="text-xs font-mono tracking-widest" style={{ color: 'var(--color-text-muted)' }}>
              {roomCode}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            {round ? `${round.hand_size} card${round.hand_size !== 1 ? 's' : ''} this round` : ''}
          </span>
          {leavePending ? (
            <div className="flex items-center gap-2">
              <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Leave game?</span>
              <button
                onClick={async () => {
                  try {
                    const res = await fetch(`/api/games/${gameId}/leave`, { method: 'POST' })
                    if (!res.ok) console.error('[leave] server returned', res.status)
                  } catch (err) {
                    // best-effort — redirect regardless so the player can leave
                    console.error('[leave] fetch failed:', err)
                  }
                  router.push('/')
                }}
                className="text-xs px-3 py-2 rounded font-medium"
                style={{ backgroundColor: 'var(--color-error)', color: 'var(--color-text-on-accent)' }}
              >
                Yes, leave
              </button>
              <button
                onClick={() => setLeavePending(false)}
                className="text-xs px-3 py-2 rounded"
                style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text-muted)' }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setLeavePending(true)}
              className="text-xs px-2 py-2"
              style={{ color: 'var(--color-text-muted)' }}
            >
              Leave
            </button>
          )}
        </div>
      </header>

      {/* Game board — three rows: opponent / table / you */}
      <div className="flex-1 flex flex-col max-w-lg mx-auto w-full px-4 py-4 gap-4">

        {/* Scoreboard */}
        <Scoreboard scores={scoreboardData} currentRoundNumber={round?.round_number ?? 1} />

        {/* ── Opponent row (top) ─────────────────────────── */}
        <div className="flex flex-wrap justify-center gap-4">
          {opponents.map((p) => {
            const label = getBidLabel(p.userId)
            return (
              <div key={p.userId} className="flex flex-col items-center gap-1" style={{ minWidth: '64px' }}>
                {p.avatarUrl ? (
                  <img src={p.avatarUrl} alt={p.displayName} className="w-12 h-12 rounded-full object-cover" />
                ) : (
                  <div className="w-12 h-12 rounded-full flex items-center justify-center text-base font-bold" style={{ backgroundColor: 'var(--color-surface-raised)' }}>
                    {p.displayName[0].toUpperCase()}
                  </div>
                )}
                <span className="text-sm font-medium text-center leading-tight">{p.displayName}</span>
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
                backgroundColor: 'var(--color-primary-light)',
              }}
            >
              {statusMessage}
            </p>
          )}

          {/* Reconnection banners — one per disconnected player */}
          {disconnectedPlayers.size > 0 && (
            <div className="flex flex-col gap-2 w-full max-w-sm">
              {[...disconnectedPlayers.entries()].map(([playerId, disconnectedAt]) => {
                const displayName = playerMap[playerId]?.displayName ?? 'A player'
                return (
                  <ReconnectionBanner
                    key={playerId}
                    displayName={displayName}
                    disconnectedAt={disconnectedAt}
                    onExpired={async function onExpiredFn() {
                      try {
                        const res = await fetch(`/api/games/${gameId}/drop-player`, {
                          method: 'POST',
                          headers: { 'content-type': 'application/json' },
                          body: JSON.stringify({ disconnectedUserId: playerId }),
                        })
                        const data = await res.json() as { status: string }
                        if (res.ok && (data.status === 'dropped' || data.status === 'already_dropped')) {
                          setDisconnectedPlayers((prev) => {
                            const next = new Map(prev)
                            next.delete(playerId)
                            return next
                          })
                          setDroppedPlayers((prev) => new Set(prev).add(playerId))
                        } else if (res.status === 422) {
                          // too_early: server clock ahead of client — retry in 5s
                          setTimeout(onExpiredFn, 5_000)
                        }
                      } catch (err) {
                        console.error('[drop-player] fetch failed:', err)
                      }
                    }}
                  />
                )
              })}
            </div>
          )}

          {/* Turn timer — only when host configured a timer and a turn is active */}
          {turnTimerSeconds !== null && round?.turn_started_at && (isBidding || isPlaying) && (
            <TurnTimer
              turnStartedAt={round.turn_started_at}
              turnTimerSeconds={turnTimerSeconds}
              gameId={gameId}
            />
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
                  onCardPlayed={handleCardPlayed}
                  ledSuit={(currentTrick?.led_suit ?? null) as Suit | null}
                  trumpSuit={round!.trump_suit}
                  handOnly
                />
              ) : (
                // Read-only hand during bidding — pyramid layout, rows of 4, centered.
                // No layoutId here (only used in TrickPanel to fly cards to center).
                <div className="space-y-2">
                  {Array.from({ length: Math.ceil(hand.length / 4) }, (_, rowIdx) =>
                    hand.slice(rowIdx * 4, rowIdx * 4 + 4)
                  ).map((row, rowIdx) => (
                    <div key={rowIdx} className="flex justify-center gap-2">
                      {row.map((card) => (
                        <motion.div
                          key={`${card.suit}:${card.value}`}
                          layout
                          transition={{ layout: { type: 'spring', stiffness: 400, damping: 30 } }}
                          className={`relative w-20 h-28 rounded-xl bg-white flex flex-col p-1.5 select-none${round?.trump_suit === card.suit ? ' ring-4 ring-[var(--color-trump)]' : ' shadow-md'}`}
                          style={round?.trump_suit === card.suit ? { boxShadow: 'var(--shadow-trump-glow)' } : undefined}
                        >
                          <span className={`text-base font-bold leading-none ${SUIT_COLOR[card.suit]}`}>{card.value}</span>
                          <div className={`flex-1 flex items-center justify-center text-4xl ${SUIT_COLOR[card.suit]}`}>
                            {SUIT_SYMBOL[card.suit]}
                          </div>
                        </motion.div>
                      ))}
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
          onClick={() => { setShowRoundSummary(false); setLeavePending(false) }}
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
                        {p.avatarUrl ? (
                          <img src={p.avatarUrl} alt={p.displayName} className="w-8 h-8 rounded-full object-cover shrink-0" />
                        ) : (
                          <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{ backgroundColor: 'var(--color-surface-raised)' }}>
                            {p.displayName[0].toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{p.displayName}</p>
                          {bid !== undefined && (
                            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                              {wonCount}/{bid} tricks
                              {exactBid && <span className="ml-1" style={{ color: 'var(--color-success)' }}>✓ exact</span>}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-base font-bold tabular-nums" style={{ color: roundScore > 0 ? 'var(--color-success)' : 'var(--color-text-muted)' }}>
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
                onClick={() => { setShowRoundSummary(false); setLeavePending(false) }}
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
