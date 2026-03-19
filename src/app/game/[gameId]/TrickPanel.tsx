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

interface Round {
  id: string
  trump_suit: string
}

interface Props {
  gameId: string
  round: Round
  hand: Card[]
  trickCards: TrickCardDisplay[]
  isMyTurn: boolean
  currentPlayerName: string | null
  onCardPlayed: (card: Card) => void
  /** Server-authoritative led suit; null until the first card of the trick is played */
  ledSuit: Suit | null
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
  hearts: 'text-red-400',
  diamonds: 'text-red-400',
  clubs: 'text-slate-200',
  spades: 'text-slate-200',
}

export function TrickPanel({ gameId, round, hand, trickCards, isMyTurn, currentPlayerName, onCardPlayed, ledSuit, handOnly = false }: Props) {
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
                  <div className={`w-12 h-16 rounded-lg bg-white flex items-center justify-center font-bold text-lg ${SUIT_COLOR[tc.suit]}`}>
                    <span>{tc.value}{SUIT_SYMBOL[tc.suit]}</span>
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
          <p className="text-sm text-slate-400 mb-3">Your hand · Trump: {round.trump_suit}</p>
          <div className="flex flex-wrap gap-2">
            {hand.map((card) => {
              const isValid = validatePlay(card, hand, ledSuit)
              return (
                <button
                  key={`${card.suit}:${card.value}`}
                  onClick={() => playCard(card)}
                  disabled={!isValid || submitting}
                  aria-label={`Play ${card.value} of ${card.suit}`}
                  className={[
                    'w-12 h-16 rounded-lg font-bold text-sm transition-colors flex items-center justify-center',
                    isValid
                      ? `bg-white ${SUIT_COLOR[card.suit]} hover:bg-slate-100`
                      : 'bg-slate-700 text-slate-500 cursor-not-allowed',
                    submitting ? 'opacity-50' : '',
                  ].join(' ')}
                >
                  {card.value}{SUIT_SYMBOL[card.suit]}
                </button>
              )
            })}
          </div>
          {error && <p className="mt-3 text-red-400 text-sm">{error}</p>}
        </div>
      ) : (
        <div className="p-4 bg-slate-800 rounded-lg">
          <p className="text-sm text-slate-400 mb-3">Your hand · Trump: {round.trump_suit}</p>
          <div className="flex flex-wrap gap-2 mb-4">
            {hand.map((card) => (
              <div
                key={`${card.suit}:${card.value}`}
                className={`w-12 h-16 rounded-lg bg-white flex items-center justify-center font-bold text-sm ${SUIT_COLOR[card.suit]}`}
              >
                {card.value}{SUIT_SYMBOL[card.suit]}
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
