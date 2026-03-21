import { render, screen, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TurnTimer } from '../TurnTimer'

// Fixed base time for all tests
const NOW = new Date('2026-03-21T10:00:00.000Z').getTime()

describe('TurnTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    global.fetch = vi.fn().mockResolvedValue({ ok: true })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  function startedSecondsAgo(seconds: number) {
    return new Date(NOW - seconds * 1000).toISOString()
  }

  // ── Display ──────────────────────────────────────────────────────────────────

  it('displays remaining seconds on initial render', () => {
    // 3s elapsed of 30s total → 27s remaining
    render(<TurnTimer turnStartedAt={startedSecondsAgo(3)} turnTimerSeconds={30} gameId="g" />)
    expect(screen.getByTestId('turn-timer')).toHaveTextContent('27s')
  })

  it('counts down each second as time passes', async () => {
    render(<TurnTimer turnStartedAt={startedSecondsAgo(3)} turnTimerSeconds={30} gameId="g" />)
    expect(screen.getByTestId('turn-timer')).toHaveTextContent('27s')

    await act(async () => { vi.advanceTimersByTime(1000) })
    expect(screen.getByTestId('turn-timer')).toHaveTextContent('26s')
  })

  // ── Color grades ─────────────────────────────────────────────────────────────

  it('applies green color when more than 60% of time remains', () => {
    // 3s elapsed of 30s = 90% remaining → green
    render(<TurnTimer turnStartedAt={startedSecondsAgo(3)} turnTimerSeconds={30} gameId="g" />)
    expect(screen.getByTestId('turn-timer')).toHaveClass('text-green-400')
  })

  it('applies amber color when 30–60% of time remains', () => {
    // 16s elapsed of 30s ≈ 47% remaining → amber
    render(<TurnTimer turnStartedAt={startedSecondsAgo(16)} turnTimerSeconds={30} gameId="g" />)
    expect(screen.getByTestId('turn-timer')).toHaveClass('text-amber-400')
  })

  it('applies red color when less than 30% of time remains', () => {
    // 23s elapsed of 30s ≈ 23% remaining → red
    render(<TurnTimer turnStartedAt={startedSecondsAgo(23)} turnTimerSeconds={30} gameId="g" />)
    expect(screen.getByTestId('turn-timer')).toHaveClass('text-red-400')
  })

  // ── Pulse ────────────────────────────────────────────────────────────────────

  it('applies pulse animation when fewer than 10 seconds remain', () => {
    // 22s elapsed of 30s = 8s remaining → pulse
    render(<TurnTimer turnStartedAt={startedSecondsAgo(22)} turnTimerSeconds={30} gameId="g" />)
    expect(screen.getByTestId('turn-timer')).toHaveClass('animate-pulse')
  })

  it('does not apply pulse animation when 10 or more seconds remain', () => {
    // 3s elapsed of 30s = 27s remaining → no pulse
    render(<TurnTimer turnStartedAt={startedSecondsAgo(3)} turnTimerSeconds={30} gameId="g" />)
    expect(screen.getByTestId('turn-timer')).not.toHaveClass('animate-pulse')
  })

  // ── Expire endpoint ──────────────────────────────────────────────────────────

  it('calls expire-turn endpoint exactly once when the timer reaches zero', async () => {
    // 28s elapsed of 30 → 2s remaining; expires after 2 more ticks
    render(<TurnTimer turnStartedAt={startedSecondsAgo(28)} turnTimerSeconds={30} gameId="game-1" />)

    await act(async () => { vi.advanceTimersByTime(3000) })

    expect(global.fetch).toHaveBeenCalledOnce()
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/games/game-1/expire-turn',
      { method: 'POST' }
    )
  })

  it('does not call expire-turn a second time after it already fired', async () => {
    render(<TurnTimer turnStartedAt={startedSecondsAgo(28)} turnTimerSeconds={30} gameId="g" />)

    // Advance well past expiry — multiple interval ticks
    await act(async () => { vi.advanceTimersByTime(10_000) })

    expect(global.fetch).toHaveBeenCalledOnce()
  })

  it('calls expire-turn again when turnStartedAt changes to a new turn', async () => {
    // Expire the first turn
    const { rerender } = render(
      <TurnTimer turnStartedAt={startedSecondsAgo(28)} turnTimerSeconds={30} gameId="g" />
    )
    await act(async () => { vi.advanceTimersByTime(3000) })
    expect(global.fetch).toHaveBeenCalledTimes(1)

    // New turn: clock is now at NOW + 3000; fresh turnStartedAt = NOW + 3000
    vi.mocked(global.fetch).mockClear()
    const freshStart = new Date(NOW + 3000).toISOString()
    rerender(<TurnTimer turnStartedAt={freshStart} turnTimerSeconds={30} gameId="g" />)

    // Advance to expiry of the new 30s turn
    await act(async () => { vi.advanceTimersByTime(31_000) })

    expect(global.fetch).toHaveBeenCalledTimes(1) // fired once for the new turn
  })
})
