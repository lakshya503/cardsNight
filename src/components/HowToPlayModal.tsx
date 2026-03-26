// src/components/HowToPlayModal.tsx
// Game-type aware "How to Play" modal. Adding a new game = add a case to the
// switch and a sibling file in src/components/rules/.
'use client'

import { useEffect } from 'react'
import { JudgementRules } from './rules/JudgementRules'

interface Props {
  gameType: string
  onClose: () => void
}

function RulesContent({ gameType }: { gameType: string }) {
  switch (gameType) {
    case 'judgement':
      return <JudgementRules />
    default:
      return <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>No rules available for this game.</p>
  }
}

export function HowToPlayModal({ gameType, onClose }: Props) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      data-testid="how-to-play-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'var(--color-overlay)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full max-w-sm rounded-xl p-5 space-y-4 shadow-lg max-h-[85vh] overflow-y-auto"
        style={{
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
        }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
            How to play
          </h2>
          <button
            data-testid="how-to-play-close"
            onClick={onClose}
            aria-label="Close"
            className="text-sm"
            style={{ color: 'var(--color-text-muted)' }}
          >
            ✕
          </button>
        </div>

        <RulesContent gameType={gameType} />
      </div>
    </div>
  )
}
