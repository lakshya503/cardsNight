'use client'

import { useState } from 'react'
import { validatePlay } from '@/lib/game/gameRules'
import type { Card, Suit } from '@/lib/game/types'

interface TrickCardDisplay {
  playerId: string
  displayName: string
  suit: string
  value: string
}

interface Props {
  gameId: string
  hand: Card[]
  trickCards: TrickCardDisplay[]
  isMyTurn: boolean
  currentPlayerName: string | null
  onCardPlayed: (card: Card) => void
  /** Server-authoritative led suit; null until the first card of the trick is played */
  ledSuit: Suit | null
  /** Current round's trump suit — used to subtly highlight trump cards in hand */
  trumpSuit: string
  /** When true, only renders the hand (trick display lives in GameShell center) */
  handOnly?: boolean
}

const SUIT_SYMBOL: Record<string, string> = {
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
  spades: '♠',
}

const SUIT_COLOR: Record<string, string> = {
  hearts: 'text-red-500',
  diamonds: 'text-red-500',
  clubs: 'text-slate-900',
  spades: 'text-slate-900',
}

export function TrickPanel({ gameId, hand, trickCards, isMyTurn, currentPlayerName, onCardPlayed, ledSuit, trumpSuit, handOnly = false }: Props) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function playCard(card: Card) {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/games/${gameId}/play`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ suit: card.suit, value: card.value }),
      })
      if (res.ok) {
        onCardPlayed(card)
      } else {
        const data = await res.json()
        setError(data.error ?? 'Failed to play card')
      }
    } catch {
      setError('Network error — please try again')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Current trick — hidden in handOnly mode (rendered in GameShell center) */}
      {!handOnly && (
        <div className="p-4 bg-slate-800 rounded-lg">
          <p className="text-sm text-slate-400 mb-3">
            Current trick
            {ledSuit && <span className="ml-2 capitalize">· {ledSuit} led</span>}
          </p>
          <div className="flex flex-wrap gap-3 min-h-[64px]">
            {trickCards.length === 0 ? (
              <p className="text-slate-500 text-sm self-center">No cards played yet</p>
            ) : (
              trickCards.map((tc) => (
                <div key={tc.playerId} className="flex flex-col items-center gap-1">
                  <div className="relative w-20 h-28 rounded-xl bg-white shadow-md flex flex-col p-1.5 select-none">
                    <span className={`text-sm font-bold leading-none ${SUIT_COLOR[tc.suit]}`}>{tc.value}</span>
                    <div className={`flex-1 flex items-center justify-center text-4xl ${SUIT_COLOR[tc.suit]}`}>
                      {SUIT_SYMBOL[tc.suit]}
                    </div>
                  </div>
                  <span className="text-xs text-slate-400">{tc.displayName}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Hand or waiting state */}
      {isMyTurn ? (
        <div className="p-4 bg-slate-800 rounded-lg">
          <p className="text-sm text-slate-400 mb-3">Your hand</p>
          <div className="flex flex-wrap gap-2">
            {hand.map((card) => {
              const isValid = validatePlay(card, hand, ledSuit)
              const isTrump = card.suit === trumpSuit
              return (
                <button
                  key={`${card.suit}:${card.value}`}
                  onClick={() => playCard(card)}
                  disabled={!isValid || submitting}
                  aria-label={`Play ${card.value} of ${card.suit}`}
                  className={[
                    'relative w-20 h-28 rounded-xl bg-white shadow-md flex flex-col p-1.5 select-none transition-opacity',
                    isTrump ? 'ring-2 ring-amber-400/70' : '',
                    isValid
                      ? `hover:ring-2 hover:ring-indigo-400`
                      : 'opacity-40 cursor-not-allowed',
                    submitting ? 'opacity-50' : '',
                  ].join(' ')}
                >
                  <span className={`text-base font-bold leading-none ${SUIT_COLOR[card.suit]}`}>{card.value}</span>
                  <div className={`flex-1 flex items-center justify-center text-4xl ${SUIT_COLOR[card.suit]}`}>
                    {SUIT_SYMBOL[card.suit]}
                  </div>
                </button>
              )
            })}
          </div>
          {error && <p className="mt-3 text-red-400 text-sm">{error}</p>}
        </div>
      ) : (
        <div className="p-4 bg-slate-800 rounded-lg">
          <p className="text-sm text-slate-400 mb-3">Your hand</p>
          <div className="flex flex-wrap gap-2 mb-4">
            {hand.map((card) => (
              <div
                key={`${card.suit}:${card.value}`}
                className={`relative w-20 h-28 rounded-xl bg-white shadow-md flex flex-col p-1.5 select-none${card.suit === trumpSuit ? ' ring-2 ring-amber-400/70' : ''}`}
              >
                <span className={`text-base font-bold leading-none ${SUIT_COLOR[card.suit]}`}>{card.value}</span>
                <div className={`flex-1 flex items-center justify-center text-4xl ${SUIT_COLOR[card.suit]}`}>
                  {SUIT_SYMBOL[card.suit]}
                </div>
              </div>
            ))}
          </div>
          <p className="text-slate-400 text-sm">
            Waiting for {currentPlayerName ?? 'other player'} to play…
          </p>
        </div>
      )}
    </div>
  )
}
