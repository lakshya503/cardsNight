'use client'

import { motion } from 'framer-motion'
import Link from 'next/link'

interface Result {
  player_id: string
  placement: number
  result: string
  total_score: number
  display_name: string
}

interface Props {
  results: Result[]
  currentUserId: string
  isWinner: boolean
}

export function ResultsPanel({ results, currentUserId, isWinner }: Props) {
  return (
    <div className="w-full max-w-md space-y-6">
      <motion.div
        className="text-center"
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
      >
        <h1 className="text-4xl font-bold mb-2" style={{ fontFamily: 'var(--font-display)' }}>
          {isWinner ? '🏆 You won!' : 'Game over'}
        </h1>
        <p className="text-slate-400">Final standings</p>
      </motion.div>

      <div data-testid="results-panel" className="bg-slate-800 rounded-xl overflow-hidden">
        {results.map((r, i) => {
          const isMe = r.player_id === currentUserId
          const isFirst = r.placement === 1
          return (
            <motion.div
              key={r.player_id}
              initial={{ x: -40, opacity: 0 }}
              animate={
                isFirst
                  ? { x: 0, opacity: 1, scale: [1, 1.04, 1] }
                  : { x: 0, opacity: 1 }
              }
              transition={
                isFirst
                  ? { delay: i * 0.15, type: 'spring', stiffness: 280, damping: 24, scale: { delay: i * 0.15 + 0.35, duration: 0.4 } }
                  : { delay: i * 0.15, type: 'spring', stiffness: 280, damping: 24 }
              }
              className={[
                'flex items-center justify-between p-4',
                i < results.length - 1 ? 'border-b border-slate-700' : '',
                isMe ? 'bg-slate-700' : '',
                isFirst ? 'ring-1 ring-inset ring-amber-400/40' : '',
              ].join(' ')}
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl font-bold text-slate-500 w-8">
                  {r.placement}
                </span>
                <div>
                  <p className="font-semibold">
                    {r.display_name}{' '}
                    {isMe && <span className="text-xs text-indigo-400">(you)</span>}
                  </p>
                  <p className="text-xs text-slate-400">
                    {r.result === 'win' ? '🏆 Winner' : 'Finished'}
                  </p>
                </div>
              </div>
              <span className="text-xl font-bold tabular-nums">{r.total_score}</span>
            </motion.div>
          )
        })}
      </div>

      <motion.div
        className="flex justify-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: results.length * 0.15 + 0.2 }}
      >
        <Link
          href="/"
          className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 rounded-lg font-semibold transition-colors"
        >
          Back to home
        </Link>
      </motion.div>
    </div>
  )
}
