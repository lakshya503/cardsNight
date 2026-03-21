'use client'

import { useEffect, useRef, useState } from 'react'

interface Props {
  turnStartedAt: string    // ISO 8601; non-null (parent only renders when non-null)
  turnTimerSeconds: number // total duration of the turn
  gameId: string
}

export function TurnTimer({ turnStartedAt, turnTimerSeconds, gameId }: Props) {
  const totalMs = turnTimerSeconds * 1000

  function computeRemaining() {
    const expiredAt = new Date(turnStartedAt).getTime() + totalMs
    return Math.max(0, expiredAt - Date.now())
  }

  const [remainingMs, setRemainingMs] = useState(computeRemaining)
  const firedRef = useRef(false)

  // Reset state and fired guard whenever the turn changes
  useEffect(() => {
    firedRef.current = false
    setRemainingMs(computeRemaining())
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnStartedAt])

  // Tick every second; fire expire endpoint once when time runs out
  useEffect(() => {
    const interval = setInterval(() => {
      const remaining = computeRemaining()
      setRemainingMs(remaining)

      if (remaining === 0 && !firedRef.current) {
        firedRef.current = true
        fetch(`/api/games/${gameId}/expire-turn`, { method: 'POST' })
      }
    }, 1000)

    return () => clearInterval(interval)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnStartedAt, turnTimerSeconds, gameId])

  const ratio = totalMs > 0 ? remainingMs / totalMs : 0
  const remainingSeconds = Math.ceil(remainingMs / 1000)

  const colorClass =
    ratio > 0.6 ? 'text-green-400' :
    ratio > 0.3 ? 'text-amber-400' :
    'text-red-400'

  const pulseClass = remainingSeconds < 10 && remainingMs > 0 ? 'animate-pulse' : ''

  return (
    <div
      role="timer"
      data-testid="turn-timer"
      className={`tabular-nums font-mono text-sm font-semibold ${colorClass} ${pulseClass}`}
    >
      {remainingSeconds}s
    </div>
  )
}
