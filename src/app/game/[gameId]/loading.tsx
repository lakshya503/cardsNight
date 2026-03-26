// src/app/game/[gameId]/loading.tsx
export default function GameLoading() {
  return (
    <main
      className="min-h-screen flex flex-col"
      style={{ backgroundColor: 'var(--color-background)' }}
    >
      {/* Header skeleton */}
      <div
        className="flex items-center justify-between px-4 py-3 shrink-0"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <div className="h-4 w-24 rounded animate-pulse" style={{ backgroundColor: 'var(--color-surface-raised)' }} />
        <div className="h-4 w-16 rounded animate-pulse" style={{ backgroundColor: 'var(--color-surface-raised)' }} />
      </div>

      {/* Round info skeleton */}
      <div className="px-4 pt-4 pb-2 flex items-center justify-between">
        <div className="h-4 w-32 rounded animate-pulse" style={{ backgroundColor: 'var(--color-surface-raised)' }} />
        <div className="h-4 w-20 rounded animate-pulse" style={{ backgroundColor: 'var(--color-surface-raised)' }} />
      </div>

      {/* Opponents skeleton */}
      <div className="px-4 py-2 flex gap-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-10 w-20 rounded-lg animate-pulse" style={{ backgroundColor: 'var(--color-surface)' }} />
        ))}
      </div>

      {/* Hand skeleton */}
      <div className="flex-1 flex items-end justify-center pb-8 px-4">
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="w-14 h-20 sm:w-16 sm:h-24 rounded-xl animate-pulse"
              style={{ backgroundColor: 'var(--color-surface)', animationDelay: `${i * 80}ms` }}
            />
          ))}
        </div>
      </div>
    </main>
  )
}
