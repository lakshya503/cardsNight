'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { copy } from '@/lib/ui/copy'
import { signOut } from '@/app/auth/actions'
import { MIN_PLAYERS } from '@/lib/game/validation'
import { AnimatePresence, motion } from 'framer-motion'

type Player = {
  userId: string
  status: string
  joinedAt: string
  displayName: string
  avatarUrl: string | null
}

type Room = {
  id: string
  code: string
  hostId: string
  status: string
  maxPlayers: number
  turnTimerSeconds: number | null
  gameType: string
}

interface WaitingRoomProps {
  room: Room
  initialPlayers: Player[]
  currentUserId: string
}

export default function WaitingRoom({ room, initialPlayers, currentUserId }: WaitingRoomProps) {
  const router = useRouter()
  const [players, setPlayers] = useState<Player[]>(initialPlayers)
  const [copied, setCopied] = useState(false)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const isHost = currentUserId === room.hostId

  const inviteUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/room/${room.code}`
      : `/room/${room.code}`

  // Sync server-provided player list into client state after every router.refresh().
  // router.refresh() re-runs the Server Component which always has correct auth via
  // middleware cookies, so initialPlayers is always authoritative. useState initial
  // values don't update automatically on prop changes — this effect bridges the gap.
  // We use a derived key so we only re-sync when the actual player list changes.
  const playerKey = initialPlayers.map(p => `${p.userId}:${p.status}`).join(',')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setPlayers(initialPlayers) }, [playerKey])

  // Polling fallback: call router.refresh() every 3 s so the server re-fetches the
  // player list and game-start state. Server-side auth (middleware cookies) is always
  // reliable — browser-side Supabase queries can silently fail when auth cookies are
  // not picked up correctly by createBrowserClient in production.
  useEffect(() => {
    const interval = setInterval(async () => {
      router.refresh()

      // Also check rooms directly for game-start navigation. This is the only place
      // we still use the browser Supabase client — it's a single lightweight query
      // and the redirect is time-sensitive (can't wait for a full server re-render
      // to propagate). Realtime covers the fast path; this is the backup.
      const supabase = createClient()
      const { data } = await supabase
        .from('rooms')
        .select('status, current_game_id')
        .eq('id', room.id)
        .maybeSingle()

      if (data?.status === 'in_progress' && data.current_game_id) {
        router.push(`/game/${data.current_game_id}`)
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [room.id, router])

  // Subscribe to room_players changes (player list) and rooms changes (game start).
  useEffect(() => {
    const supabase = createClient()
    let channel: ReturnType<typeof supabase.channel> | null = null

    // createBrowserClient only calls realtime.setAuth() on auth state *transitions*
    // (SIGNED_IN / TOKEN_REFRESHED). An existing cookie session on page load fires no
    // state change, so the WebSocket connects without a JWT. Supabase then evaluates
    // auth.uid() = null for every RLS policy → no events delivered even though the
    // channel shows SUBSCRIBED. Manually inject the token before subscribing.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.access_token) {
        supabase.realtime.setAuth(session.access_token)
      }

      channel = supabase
        .channel(`waiting-room-${room.id}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'room_players', filter: `room_id=eq.${room.id}` },
          // router.refresh() re-runs the server component — more reliable than a
          // browser-side Supabase query since server auth always works.
          () => router.refresh()
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${room.id}` },
          (payload) => {
            const updated = payload.new as { status: string; current_game_id: string | null }
            if (updated.status === 'in_progress' && updated.current_game_id) {
              router.push(`/game/${updated.current_game_id}`)
            }
          }
        )
        .subscribe((status, err) => {
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.error('[RT] WaitingRoom channel error (polling will cover):', err)
          }
        })
    })

    return () => {
      if (channel) supabase.removeChannel(channel)
    }
  }, [room.id, router])

  async function copyInviteLink() {
    await navigator.clipboard.writeText(inviteUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  const activeCount = players.filter((p) => p.status !== 'dropped').length
  const canStart = isHost && activeCount >= MIN_PLAYERS

  async function leaveRoom() {
    if (!window.confirm(copy.waitingRoom.leaveRoomConfirm)) return
    await fetch(`/api/rooms/${room.code}/leave`, { method: 'POST' })
    router.push('/')
  }

  return (
    <main
      className="min-h-screen flex flex-col"
      style={{ backgroundColor: 'var(--color-background)' }}
    >
      {/* Header */}
      <header
        className="flex items-center justify-between px-6 py-4"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <Link
          href="/"
          className="text-2xl font-bold"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          🃏{' '}
          <span style={{ color: 'var(--color-text)' }}>cards</span>
          <span style={{ color: 'var(--color-primary)' }}>Night</span>
        </Link>
        <form action={signOut}>
          <button
            type="submit"
            className="text-sm cursor-pointer"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {copy.auth.signOutButton}
          </button>
        </form>
      </header>

      <div className="flex-1 flex flex-col items-center px-4 py-10 gap-8 max-w-2xl mx-auto w-full">

        {/* Room code + invite */}
        <div
          className="w-full flex flex-col items-center gap-4 p-6"
          style={{
            backgroundColor: 'var(--color-primary-light)',
            borderRadius: 'var(--radius-xl)',
          }}
        >
          <p className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
            {copy.waitingRoom.roomCodeLabel}
          </p>
          <p
            className="text-5xl font-bold tracking-widest"
            style={{ fontFamily: 'monospace', color: 'var(--color-primary)' }}
          >
            {room.code}
          </p>
          <button
            onClick={copyInviteLink}
            className="btn-primary px-5 py-2 text-sm font-medium"
          >
            {copied ? copy.waitingRoom.linkCopied : copy.waitingRoom.copyLink}
          </button>
        </div>

        {/* Room details */}
        <div
          className="w-full grid grid-cols-3 gap-4 text-center"
        >
          {[
            { label: 'Game', value: '⚖️ Judgement' },
            {
              label: copy.createRoom.maxPlayersLabel,
              value: copy.waitingRoom.playerCount(activeCount, room.maxPlayers),
            },
            {
              label: copy.createRoom.timerLabel,
              value: room.turnTimerSeconds ? `${room.turnTimerSeconds}s` : 'No timer ∞',
            },
          ].map(({ label, value }) => (
            <div
              key={label}
              className="flex flex-col gap-1 p-4"
              style={{
                backgroundColor: 'var(--color-surface)',
                borderRadius: 'var(--radius-lg)',
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              <p className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>
                {label}
              </p>
              <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                {value}
              </p>
            </div>
          ))}
        </div>

        {/* Player list */}
        <div className="w-full flex flex-col gap-4">
          <h2
            className="text-xl font-bold"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text)' }}
          >
            {copy.waitingRoom.heading}
          </h2>

          <AnimatePresence>
          <div className="flex flex-col gap-2">
            {players.map((player) => {
              const isCurrentUser = player.userId === currentUserId
              const isRoomHost = player.userId === room.hostId

              return (
                <motion.div
                  key={player.userId}
                  initial={{ x: -24, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: 24, opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 320, damping: 28 }}
                  className="flex items-center gap-3 px-4 py-3"
                  style={{
                    backgroundColor: 'var(--color-surface)',
                    borderRadius: 'var(--radius-lg)',
                    boxShadow: 'var(--shadow-sm)',
                    border: isCurrentUser ? '2px solid var(--color-primary-light)' : 'none',
                  }}
                >
                  {/* Avatar */}
                  {player.avatarUrl ? (
                    <Image
                      src={player.avatarUrl}
                      alt={player.displayName}
                      width={40}
                      height={40}
                      className="rounded-full"
                    />
                  ) : (
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold"
                      style={{
                        backgroundColor: 'var(--color-primary-light)',
                        color: 'var(--color-primary)',
                      }}
                    >
                      {player.displayName[0].toUpperCase()}
                    </div>
                  )}

                  {/* Name + badges */}
                  <div className="flex items-center gap-2 flex-1">
                    <span className="font-medium text-sm" style={{ color: 'var(--color-text)' }}>
                      {player.displayName}
                    </span>
                    {isRoomHost && (
                      <span
                        className="text-xs px-2 py-0.5 font-semibold rounded-full"
                        style={{
                          border: '1px solid var(--color-primary)',
                          color: 'var(--color-primary)',
                          backgroundColor: 'transparent',
                        }}
                      >
                        👑 {copy.waitingRoom.hostBadge}
                      </span>
                    )}
                    {isCurrentUser && (
                      <span
                        className="text-xs px-2 py-0.5 font-semibold rounded-full"
                        style={{
                          backgroundColor: 'var(--color-accent)',
                          color: 'var(--color-text-on-accent)',
                        }}
                      >
                        {copy.waitingRoom.youBadge}
                      </span>
                    )}
                  </div>
                </motion.div>
              )
            })}
          </div>
          </AnimatePresence>
        </div>

        {/* Host controls / waiting message */}
        <div className="w-full">
          {isHost ? (
            <div className="flex flex-col gap-2">
              <button
                disabled={!canStart || starting}
                className="btn-primary w-full py-3 font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={async () => {
                  setStarting(true)
                  setStartError(null)
                  const res = await fetch(`/api/rooms/${room.code}/start`, { method: 'POST' })
                  if (!res.ok) {
                    const json = await res.json().catch(() => ({}))
                    setStartError(json.error ?? 'Failed to start game. Please try again.')
                    setStarting(false)
                    return
                  }
                  // Host redirects directly from the API response.
                  // Other players are redirected via the rooms UPDATE Realtime event.
                  const { gameId } = await res.json()
                  router.push(`/game/${gameId}`)
                }}
              >
                {copy.waitingRoom.startGame}
              </button>
              {!canStart && (
                <p className="text-sm text-center" style={{ color: 'var(--color-text-muted)' }}>
                  {copy.waitingRoom.startGameDisabled(MIN_PLAYERS)}
                </p>
              )}
              {startError && (
                <p className="text-sm text-center" style={{ color: 'var(--color-error)' }}>
                  {startError}
                </p>
              )}
            </div>
          ) : (
            <p
              className="text-center text-sm py-3"
              style={{ color: 'var(--color-text-muted)' }}
            >
              {copy.waitingRoom.waitingForHost}
            </p>
          )}
        </div>

        {/* Leave room */}
        <div className="w-full pt-2">
          <button
            onClick={leaveRoom}
            className="w-full py-3 text-sm font-semibold cursor-pointer"
            style={{
              backgroundColor: 'var(--color-error-light)',
              color: 'var(--color-error)',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--color-error)',
            }}
          >
            {copy.waitingRoom.leaveRoom}
          </button>
        </div>

      </div>
    </main>
  )
}
