'use client'

interface PlayerScore {
  userId: string
  displayName: string
  total: number
}

interface Props {
  scores: PlayerScore[]
  currentRoundNumber: number
}

export function Scoreboard({ scores, currentRoundNumber }: Props) {
  const sorted = [...scores].sort((a, b) => b.total - a.total)

  return (
    <div className="p-4 rounded-lg" style={{ backgroundColor: 'var(--color-surface)' }}>
      <h2 className="text-sm font-semibold mb-3 uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>
        Scores · Round {currentRoundNumber}
      </h2>
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {sorted.map((s, i) => (
          <div key={s.userId} className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm w-4" style={{ color: 'var(--color-text-muted)' }}>{i + 1}</span>
              <span className="text-sm">{s.displayName}</span>
            </div>
            <span className="font-bold tabular-nums text-sm">{s.total}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
