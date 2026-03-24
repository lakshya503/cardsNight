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

  // Reset state and fired guard whenever the turn changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- computeRemaining is stable per-turn;
  // this effect only needs to re-run when the turn identity (turnStartedAt) changes.
  useEffect(() => {
    firedRef.current = false
    setRemainingMs(computeRemaining())
  }, [turnStartedAt])

  // Tick every second; fire expire endpoint once when time runs out.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- computeRemaining re-reads Date.now()
  // on each tick so the closure over turnStartedAt/totalMs is intentionally stable per-turn;
  // the effect correctly re-registers when those values change via the explicit dep array.
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
  }, [turnStartedAt, turnTimerSeconds, gameId])

  const ratio = totalMs > 0 ? remainingMs / totalMs : 0
  const remainingSeconds = Math.ceil(remainingMs / 1000)

  const colorLevel = ratio > 0.6 ? 'green' : ratio > 0.3 ? 'amber' : 'red'
  const color =
    colorLevel === 'green' ? 'var(--color-success)' :
    colorLevel === 'amber' ? 'var(--color-warning)' :
    'var(--color-error)'

  const pulseClass = remainingSeconds < 10 && remainingMs > 0 ? 'animate-pulse' : ''

  return (
    <div
      role="timer"
      data-testid="turn-timer"
      data-color-level={colorLevel}
      className={['tabular-nums font-mono text-sm font-semibold', pulseClass].filter(Boolean).join(' ')}
      style={{ color }}
    >
      {remainingSeconds}s
    </div>
  )
}
