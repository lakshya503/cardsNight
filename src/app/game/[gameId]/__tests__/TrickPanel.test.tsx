import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { TrickPanel } from '../TrickPanel'

global.fetch = vi.fn()

const DEFAULT_PROPS = {
  gameId: 'game-1',
  hand: [{ suit: 'hearts' as const, value: '3' as const }],
  trickCards: [],
  isMyTurn: true,
  onCardPlayed: vi.fn(),
  ledSuit: 'hearts' as const,
  trumpSuit: 'spades',
}

describe('TrickPanel error auto-dismiss', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(fetch).mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('clears the play error after 4 seconds', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Must follow suit' }), { status: 422 })
    )

    render(<TrickPanel {...DEFAULT_PROPS} />)

    // fireEvent doesn't use internal timers unlike userEvent
    fireEvent.click(screen.getByLabelText(/play 3 of hearts/i))

    // Flush all pending microtasks/promises so the async playCard function resolves
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.getByText('Must follow suit')).toBeInTheDocument()

    act(() => { vi.advanceTimersByTime(4000) })

    expect(screen.queryByText('Must follow suit')).not.toBeInTheDocument()
  })
})
