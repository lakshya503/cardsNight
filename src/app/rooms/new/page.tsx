'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { copy } from '@/lib/ui/copy'
import {
  MIN_PLAYERS,
  MAX_PLAYERS,
  MIN_TIMER_SECONDS,
  MAX_TIMER_SECONDS,
} from '@/lib/game/validation'

const TIMER_OPTIONS = [
  { label: copy.createRoom.timerNoneOption, value: '' },
  { label: '15s', value: '15' },
  { label: '30s', value: '30' },
  { label: '45s', value: '45' },
  { label: '60s', value: '60' },
  { label: '90s', value: '90' },
  { label: '120s', value: '120' },
]

export default function CreateRoomPage() {
  const router = useRouter()
  const [maxPlayers, setMaxPlayers] = useState(6)
  const [timerSeconds, setTimerSeconds] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          game_type: 'judgement',
          max_players: maxPlayers,
          turn_timer_seconds: timerSeconds ? parseInt(timerSeconds, 10) : null,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? copy.errors.generic)
        return
      }

      router.push(`/room/${data.code}`)
    } catch {
      setError(copy.errors.generic)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main
      className="min-h-screen flex items-center justify-center px-4"
      style={{ backgroundColor: 'var(--color-background)' }}
    >
      <div
        className="w-full max-w-md flex flex-col gap-8 p-6 sm:p-10"
        style={{
          backgroundColor: 'var(--color-surface)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        {/* Header */}
        <div>
          <Link
            href="/"
            className="text-sm mb-4 inline-block"
            style={{ color: 'var(--color-text-muted)' }}
          >
            ← Back
          </Link>
          <h1
            className="text-3xl font-bold"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text)' }}
          >
            {copy.createRoom.heading}
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--color-text-muted)' }}>
            Game: <strong>Judgement</strong>
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          {/* Max players */}
          <div className="flex flex-col gap-2">
            <label
              htmlFor="max-players"
              className="text-sm font-medium"
              style={{ color: 'var(--color-text)' }}
            >
              {copy.createRoom.maxPlayersLabel}
              <span className="ml-1 font-bold" style={{ color: 'var(--color-primary)' }}>
                {maxPlayers}
              </span>
            </label>
            <input
              id="max-players"
              type="range"
              min={MIN_PLAYERS}
              max={MAX_PLAYERS}
              value={maxPlayers}
              onChange={(e) => setMaxPlayers(parseInt(e.target.value, 10))}
              className="w-full accent-[var(--color-primary)]"
            />
            <div
              className="flex justify-between text-xs"
              style={{ color: 'var(--color-text-muted)' }}
            >
              <span>{MIN_PLAYERS} min</span>
              <span>{MAX_PLAYERS} max</span>
            </div>
          </div>

          {/* Turn timer */}
          <div className="flex flex-col gap-2">
            <label
              htmlFor="timer"
              className="text-sm font-medium"
              style={{ color: 'var(--color-text)' }}
            >
              {copy.createRoom.timerLabel}
            </label>
            <select
              id="timer"
              value={timerSeconds}
              onChange={(e) => setTimerSeconds(e.target.value)}
              className="w-full px-3 py-2 text-sm"
              style={{
                backgroundColor: 'var(--color-surface)',
                color: 'var(--color-text)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              {TIMER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Error */}
          {error && (
            <p
              className="text-sm px-4 py-3 rounded-lg"
              style={{
                backgroundColor: 'var(--color-error-light)',
                color: 'var(--color-error)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              {error}
            </p>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full py-3 font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? copy.createRoom.submitting : copy.createRoom.submitButton}
          </button>
        </form>
      </div>
    </main>
  )
}
