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
    const expiredAt = new Date(disconnectedAt).getTime() + RECONNECT_WINDOW_MS
    return Math.max(0, expiredAt - Date.now())
  }

  const [remainingMs, setRemainingMs] = useState(computeRemaining)
  const firedRef = useRef(false)
  // Stable ref for onExpired so the interval never re-creates due to parent re-renders
  const onExpiredRef = useRef(onExpired)
  useEffect(() => { onExpiredRef.current = onExpired }, [onExpired])

  // Reset when the disconnectedAt changes (new disconnect event)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- computeRemaining is stable per disconnect; only resets on identity change
  useEffect(() => {
    firedRef.current = false
    setRemainingMs(computeRemaining())
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
      className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-900/30 px-4 py-2.5 text-sm"
    >
      <span className="text-amber-200">
        <span className="font-semibold">{displayName}</span> disconnected — reconnecting…
      </span>
      <span
        data-testid="reconnection-countdown"
        className={`tabular-nums font-mono font-semibold ${isUrgent ? 'text-red-400' : 'text-amber-400'}`}
      >
        {remainingSeconds}s
      </span>
    </div>
  )
}
