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

  return (
    <div className="p-4 rounded-lg" style={{ backgroundColor: 'var(--color-surface)' }}>
      <h2 className="text-lg font-semibold mb-4">Place your bid</h2>

      {isLastBidder && forbiddenBid !== null && forbiddenBid >= 0 && forbiddenBid <= round.hand_size && (
        <p className="text-sm mb-3" style={{ color: 'var(--color-primary)' }}>
          You cannot bid {forbiddenBid} — bids must not sum to exactly {round.hand_size}.
        </p>
      )}

      <div className="grid grid-cols-3 gap-2 place-items-center">
        {Array.from({ length: round.hand_size + 1 }, (_, i) => i).map((n) => {
          const isValid = validBids.includes(n)
          return (
            <button
              key={n}
              onClick={() => submitBid(n)}
              disabled={!isValid || submitting}
              aria-label={`Bid ${n}`}
              className={['w-12 h-12 rounded-lg font-bold text-lg transition-colors', submitting ? 'opacity-50' : ''].join(' ')}
              style={
                isValid
                  ? { backgroundColor: 'var(--color-primary)', color: 'var(--color-text-on-primary)' }
                  : { backgroundColor: 'var(--color-surface-raised)', color: 'var(--color-text-muted)', cursor: 'not-allowed' }
              }
            >
              {n}
            </button>
          )
        })}
      </div>

      {error && <p className="mt-3 text-sm" style={{ color: 'var(--color-error)' }}>{error}</p>}
    </div>
  )
}
