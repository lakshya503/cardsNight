'use client'

import { useState } from 'react'
import { getValidBids } from '@/lib/game/gameRules'

interface Round {
  id: string
  hand_size: number
}

interface Bid {
  player_id: string
  amount: number
}

interface Props {
  gameId: string
  round: Round
  existingBids: Bid[]
  playerCount: number
}

export function BiddingPanel({ gameId, round, existingBids, playerCount }: Props) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isLastBidder = existingBids.length === playerCount - 1
  const existingAmounts = existingBids.map((b) => b.amount)
  const validBids = getValidBids(round.hand_size, existingAmounts, isLastBidder)

  const forbiddenBid = isLastBidder
    ? round.hand_size - existingAmounts.reduce((s, a) => s + a, 0)
    : null

  async function submitBid(amount: number) {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/games/${gameId}/bid`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ amount }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error ?? 'Failed to place bid')
      }
    } catch {
      setError('Network error — please try again')
    } finally {
      setSubmitting(false)
    }
  }

  const showForbidden = isLastBidder && forbiddenBid !== null && forbiddenBid >= 0 && forbiddenBid <= round.hand_size

  if (round.hand_size === 0) {
    return (
      <div className="p-4 rounded-lg" style={{ backgroundColor: 'var(--color-surface)' }}>
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>No bids available.</p>
      </div>
    )
  }

  return (
    <div className="p-4 rounded-lg" style={{ backgroundColor: 'var(--color-surface)' }}>
      <h2 className="text-base font-semibold mb-3">Place your bid</h2>

      <div className="flex flex-wrap gap-1.5">
        {Array.from({ length: round.hand_size + 1 }, (_, i) => i).map((n) => {
          const isValid = validBids.includes(n)
          const isForbidden = showForbidden && n === forbiddenBid
          return (
            <button
              key={n}
              onClick={() => submitBid(n)}
              disabled={!isValid || submitting}
              aria-label={isForbidden ? `Bid ${n} — forbidden` : `Bid ${n}`}
              className={['w-10 h-10 rounded-lg font-bold text-base transition-colors relative', submitting ? 'opacity-50' : ''].filter(Boolean).join(' ')}
              style={
                isValid
                  ? { backgroundColor: 'var(--color-primary)', color: 'var(--color-text-on-primary)' }
                  : { backgroundColor: 'var(--color-surface-raised)', color: 'var(--color-text-muted)', cursor: 'not-allowed' }
              }
            >
              {isForbidden ? (
                <span className="relative inline-flex items-center justify-center">
                  <span className="opacity-40">{n}</span>
                  <span className="absolute inset-0 flex items-center justify-center">
                    <span className="block h-px w-5 rotate-45" style={{ backgroundColor: 'var(--color-text-muted)' }} />
                  </span>
                </span>
              ) : n}
            </button>
          )
        })}
      </div>

      {showForbidden && (
        <p className="mt-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
          Bid {forbiddenBid} is not allowed — bids cannot sum to exactly {round.hand_size}.
        </p>
      )}

      {error && <p className="mt-2 text-sm" style={{ color: 'var(--color-error)' }}>{error}</p>}
    </div>
  )
}
