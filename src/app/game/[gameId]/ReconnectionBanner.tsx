'use client'

import { useEffect, useRef, useState } from 'react'

const RECONNECT_WINDOW_MS = 60_000

interface Props {
  displayName: string
  disconnectedAt: string  // ISO 8601
  onExpired: () => void
}

export function ReconnectionBanner({ displayName, disconnectedAt, onExpired }: Props) {
  function computeRemaining() {
    const parsed = new Date(disconnectedAt).getTime()
    if (isNaN(parsed)) return 0  // Invalid date string — treat as expired
    const expiredAt = parsed + RECONNECT_WINDOW_MS
    return Math.max(0, expiredAt - Date.now())
  }

  const [remainingMs, setRemainingMs] = useState(computeRemaining)
  const firedRef = useRef(false)
  // Stable ref for onExpired so the interval never re-creates due to parent re-renders
  const onExpiredRef = useRef(onExpired)
  useEffect(() => { onExpiredRef.current = onExpired }, [onExpired])

  // Reset when disconnectedAt changes (new disconnect event); also fires at mount.
  // If already expired (remaining === 0), call onExpired immediately rather than waiting
  // up to one interval tick.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- computeRemaining is stable per disconnect; only resets on identity change
  useEffect(() => {
    firedRef.current = false
    const remaining = computeRemaining()
    setRemainingMs(remaining)
    if (remaining === 0) {
      firedRef.current = true
      onExpiredRef.current()
    }
  }, [disconnectedAt])

  // Tick every second; fire onExpired once when the window closes.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- onExpiredRef is stable; computeRemaining re-reads Date.now() on each tick so the closure over disconnectedAt is intentionally stable per disconnect
  useEffect(() => {
    const interval = setInterval(() => {
      const remaining = computeRemaining()
      setRemainingMs(remaining)

      if (remaining === 0 && !firedRef.current) {
        firedRef.current = true
        onExpiredRef.current()
      }
    }, 1000)

    return () => clearInterval(interval)
  }, [disconnectedAt])

  const remainingSeconds = Math.ceil(remainingMs / 1000)
  const isUrgent = remainingSeconds < 10 && remainingMs > 0

  return (
    <div
      data-testid="reconnection-banner"
      className="flex items-center justify-between gap-3 rounded-lg border px-4 py-2.5 text-sm"
      style={{
        borderColor: 'var(--color-warning-border)',
        backgroundColor: 'var(--color-warning-surface)',
      }}
    >
      <span style={{ color: 'var(--color-warning-subtle)' }}>
        <span className="font-semibold">{displayName}</span> disconnected — reconnecting…
      </span>
      <span
        data-testid="reconnection-countdown"
        data-urgent={isUrgent ? 'true' : 'false'}
        className="tabular-nums font-mono font-semibold"
        style={{ color: isUrgent ? 'var(--color-error)' : 'var(--color-warning)' }}
      >
        {remainingSeconds}s
      </span>
    </div>
  )
}
