import { describe, it, expect } from 'vitest'
import { extractGame, computeStats } from '../page'

describe('extractGame', () => {
  it('returns null when raw is null', () => {
    expect(extractGame(null)).toBeNull()
  })

  it('returns null when raw is undefined', () => {
    expect(extractGame(undefined)).toBeNull()
  })

  it('returns the object directly when raw is a scalar', () => {
    const game = { finished_at: '2026-03-20T10:00:00Z', rooms: { game_type: 'judgement' } }
    expect(extractGame(game)).toBe(game)
  })

  it('returns the first element when raw is an array (Supabase array-typed relation)', () => {
    const game = { finished_at: '2026-03-20T10:00:00Z', rooms: { game_type: 'judgement' } }
    expect(extractGame([game])).toBe(game)
  })

  it('returns null when raw is an empty array', () => {
    expect(extractGame([])).toBeNull()
  })
})

// ─── computeStats fixtures ────────────────────────────────────────────────────

function makeRow(result: 'win' | 'loss', finishedAt: string | null = '2026-03-20T10:00:00Z') {
  return {
    result,
    games: finishedAt ? { finished_at: finishedAt, rooms: { game_type: 'judgement' } } : null,
  }
}

describe('computeStats', () => {
  it('returns zeros and null winRate for an empty history', () => {
    const { totalGames, wins, winRate, latestFinishedAt } = computeStats([])
    expect(totalGames).toBe(0)
    expect(wins).toBe(0)
    expect(winRate).toBeNull()
    expect(latestFinishedAt).toBeNull()
  })

  it('counts total games correctly', () => {
    const rows = [makeRow('win'), makeRow('loss'), makeRow('loss')]
    expect(computeStats(rows).totalGames).toBe(3)
  })

  it('counts wins correctly', () => {
    const rows = [makeRow('win'), makeRow('win'), makeRow('loss')]
    expect(computeStats(rows).wins).toBe(2)
  })

  it('computes win rate as a rounded percentage', () => {
    const rows = [makeRow('win'), makeRow('loss'), makeRow('loss')]
    expect(computeStats(rows).winRate).toBe(33) // 1/3 = 33.33%
  })

  it('returns 100% win rate when all games are wins', () => {
    const rows = [makeRow('win'), makeRow('win')]
    expect(computeStats(rows).winRate).toBe(100)
  })

  it('returns 0% win rate when no games are wins', () => {
    const rows = [makeRow('loss'), makeRow('loss')]
    expect(computeStats(rows).winRate).toBe(0)
  })

  it('returns null winRate (not 0%) when there are no games', () => {
    expect(computeStats([]).winRate).toBeNull()
  })

  it('returns the latest finished_at across all rows', () => {
    const rows = [
      makeRow('win', '2026-03-18T10:00:00Z'),
      makeRow('loss', '2026-03-20T10:00:00Z'),  // latest
      makeRow('loss', '2026-03-19T10:00:00Z'),
    ]
    expect(computeStats(rows).latestFinishedAt).toBe('2026-03-20T10:00:00Z')
  })

  it('returns null latestFinishedAt when all games have no finished_at', () => {
    const rows = [makeRow('win', null), makeRow('loss', null)]
    expect(computeStats(rows).latestFinishedAt).toBeNull()
  })

  it('handles a mix of null and non-null finished_at', () => {
    const rows = [makeRow('win', null), makeRow('loss', '2026-03-20T10:00:00Z')]
    expect(computeStats(rows).latestFinishedAt).toBe('2026-03-20T10:00:00Z')
  })

  it('handles Supabase array-typed games relation', () => {
    const rows = [{
      result: 'win',
      games: [{ finished_at: '2026-03-20T10:00:00Z', rooms: { game_type: 'judgement' } }],
    }]
    expect(computeStats(rows).latestFinishedAt).toBe('2026-03-20T10:00:00Z')
  })
})
