import { render, screen, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ReconnectionBanner } from '../ReconnectionBanner'

const NOW = new Date('2026-03-21T10:00:00.000Z').getTime()

describe('ReconnectionBanner', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  function disconnectedSecondsAgo(seconds: number) {
    return new Date(NOW - seconds * 1000).toISOString()
  }

  // ── Display ───────────────────────────────────────────────────────────────

  it('shows the player name and remaining seconds', () => {
    render(
      <ReconnectionBanner
        displayName="Alice"
        disconnectedAt={disconnectedSecondsAgo(5)}
        onExpired={vi.fn()}
      />
    )
    expect(screen.getByTestId('reconnection-banner')).toHaveTextContent('Alice')
    expect(screen.getByTestId('reconnection-banner')).toHaveTextContent('55s')
  })

  it('counts down each second', async () => {
    render(
      <ReconnectionBanner
        displayName="Bob"
        disconnectedAt={disconnectedSecondsAgo(5)}
        onExpired={vi.fn()}
      />
    )
    expect(screen.getByTestId('reconnection-countdown')).toHaveTextContent('55s')

    await act(async () => { vi.advanceTimersByTime(3000) })
    expect(screen.getByTestId('reconnection-countdown')).toHaveTextContent('52s')
  })

  it('shows 0s when past the 60s window and does not go negative', () => {
    render(
      <ReconnectionBanner
        displayName="Charlie"
        disconnectedAt={disconnectedSecondsAgo(70)}
        onExpired={vi.fn()}
      />
    )
    expect(screen.getByTestId('reconnection-countdown')).toHaveTextContent('0s')
  })

  // ── Expiry callback ───────────────────────────────────────────────────────

  it('calls onExpired exactly once when countdown reaches zero', async () => {
    const onExpired = vi.fn()
    render(
      <ReconnectionBanner
        displayName="Dave"
        disconnectedAt={disconnectedSecondsAgo(58)}
        onExpired={onExpired}
      />
    )
    // 2s remaining; advance past expiry
    await act(async () => { vi.advanceTimersByTime(4000) })
    expect(onExpired).toHaveBeenCalledOnce()
  })

  it('calls onExpired when the component mounts with a timer already past expiry', () => {
    const onExpired = vi.fn()
    render(
      <ReconnectionBanner
        displayName="Zara"
        disconnectedAt={disconnectedSecondsAgo(70)} // 10s past 60s window
        onExpired={onExpired}
      />
    )
    // onExpired fires in the reset effect at mount — no interval tick needed
    expect(onExpired).toHaveBeenCalledOnce()
  })

  it('resets and can fire again when disconnectedAt changes to a new disconnect', async () => {
    const onExpired = vi.fn()
    const { rerender } = render(
      <ReconnectionBanner
        displayName="Alice"
        disconnectedAt={disconnectedSecondsAgo(58)} // 2s remaining
        onExpired={onExpired}
      />
    )

    // Let first disconnect expire
    await act(async () => { vi.advanceTimersByTime(4000) })
    expect(onExpired).toHaveBeenCalledTimes(1)

    // New disconnect — reset with fresh timestamp, computed from current fake time
    // (disconnectedSecondsAgo uses the original NOW constant, so we use Date.now() here)
    const newDisconnectedAt = new Date(Date.now() - 10 * 1000).toISOString() // 50s remaining
    await act(async () => {
      rerender(
        <ReconnectionBanner
          displayName="Alice"
          disconnectedAt={newDisconnectedAt}
          onExpired={onExpired}
        />
      )
    })

    // Timer should be reset
    expect(screen.getByTestId('reconnection-countdown')).toHaveTextContent('50s')

    // And fire again at expiry
    await act(async () => { vi.advanceTimersByTime(55_000) })
    expect(onExpired).toHaveBeenCalledTimes(2)
  })

  it('does not call onExpired a second time after it already fired', async () => {
    const onExpired = vi.fn()
    render(
      <ReconnectionBanner
        displayName="Eve"
        disconnectedAt={disconnectedSecondsAgo(58)}
        onExpired={onExpired}
      />
    )
    await act(async () => { vi.advanceTimersByTime(15_000) })
    expect(onExpired).toHaveBeenCalledOnce()
  })

  // ── Urgency styling ───────────────────────────────────────────────────────

  it('applies urgent styling when fewer than 10 seconds remain', () => {
    render(
      <ReconnectionBanner
        displayName="Frank"
        disconnectedAt={disconnectedSecondsAgo(52)}
        onExpired={vi.fn()}
      />
    )
    // 8s remaining → urgent
    expect(screen.getByTestId('reconnection-countdown')).toHaveClass('text-red-400')
  })

  it('does not apply urgent styling when 10 or more seconds remain', () => {
    render(
      <ReconnectionBanner
        displayName="Grace"
        disconnectedAt={disconnectedSecondsAgo(5)}
        onExpired={vi.fn()}
      />
    )
    // 55s remaining → not urgent
    expect(screen.getByTestId('reconnection-countdown')).not.toHaveClass('text-red-400')
  })
})
