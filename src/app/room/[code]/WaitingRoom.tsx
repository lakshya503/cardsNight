'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { copy } from '@/lib/ui/copy'
import { signOut } from '@/app/auth/actions'

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
  const isHost = currentUserId === room.hostId

  const inviteUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/room/${room.code}`
      : `/room/${room.code}`

  // Refetch player list — called on every Realtime event
  const refreshPlayers = useCallback(async () => {
    const supabase = createClient()
    const { data } = await supabase
      .from('room_players')
      .select(`
        user_id,
        status,
        joined_at,
        profiles (
          display_name,
          avatar_url
        )
      `)
      .eq('room_id', room.id)
      .neq('status', 'dropped')
      .order('joined_at', { ascending: true })

    if (data) {
      setPlayers(
        data.map((p) => ({
          userId: p.user_id,
          status: p.status,
          joinedAt: p.joined_at,
          displayName: (p.profiles as unknown as { display_name: string; avatar_url: string | null } | null)?.display_name ?? 'Player',
          avatarUrl: (p.profiles as unknown as { display_name: string; avatar_url: string | null } | null)?.avatar_url ?? null,
        }))
      )
    }
  }, [room.id])

  // Subscribe to room_players changes via Postgres Changes
  useEffect(() => {
    const supabase = createClient()

    const channel = supabase
      .channel(`room-players-${room.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'room_players',
          filter: `room_id=eq.${room.id}`,
        },
        () => {
          // Refetch full list — payload lacks joined profile data
          refreshPlayers()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [room.id, refreshPlayers])

  async function copyInviteLink() {
    await navigator.clipboard.writeText(inviteUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  const activeCount = players.filter((p) => p.status !== 'dropped').length
  const canStart = isHost && activeCount >= 4

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
        <span
          className="text-2xl font-bold"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--color-primary)' }}
        >
          🃏 cardsNight
        </span>
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

          <div className="flex flex-col gap-2">
            {players.map((player) => {
              const isCurrentUser = player.userId === currentUserId
              const isRoomHost = player.userId === room.hostId

              return (
                <div
                  key={player.userId}
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
                          backgroundColor: 'var(--color-accent-light)',
                          color: 'var(--color-accent-hover)',
                        }}
                      >
                        👑 {copy.waitingRoom.hostBadge}
                      </span>
                    )}
                    {isCurrentUser && (
                      <span
                        className="text-xs px-2 py-0.5 font-semibold rounded-full"
                        style={{
                          backgroundColor: 'var(--color-primary-light)',
                          color: 'var(--color-primary)',
                        }}
                      >
                        {copy.waitingRoom.youBadge}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Host controls / waiting message */}
        <div className="w-full">
          {isHost ? (
            <div className="flex flex-col gap-2">
              <button
                disabled={!canStart}
                className="btn-primary w-full py-3 font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => {/* M2: start game logic */}}
              >
                {copy.waitingRoom.startGame}
              </button>
              {!canStart && (
                <p className="text-sm text-center" style={{ color: 'var(--color-text-muted)' }}>
                  {copy.waitingRoom.startGameDisabled}
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

      </div>
    </main>
  )
}
