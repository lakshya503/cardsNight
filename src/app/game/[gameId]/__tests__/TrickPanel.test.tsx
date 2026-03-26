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

    // Move the click inside act so React state updates are flushed synchronously,
    // then the trailing async act drains any remaining microtasks/promises.
    await act(async () => {
      fireEvent.click(screen.getByLabelText(/play 3 of hearts/i))
    })

    expect(screen.getByText('Must follow suit')).toBeInTheDocument()

    await act(async () => { vi.advanceTimersByTime(4000) })

    expect(screen.queryByText('Must follow suit')).not.toBeInTheDocument()
  })
})
