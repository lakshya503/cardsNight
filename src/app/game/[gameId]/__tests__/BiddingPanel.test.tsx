import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BiddingPanel } from '../BiddingPanel'

global.fetch = vi.fn()

describe('BiddingPanel', () => {
  const defaultProps = {
    gameId: 'game-1',
    round: { id: 'round-1', hand_size: 3 },
    existingBids: [],
    playerCount: 4,
  }

  it('shows a spinner after a bid button is clicked', async () => {
    // fetch never resolves — holds submitting=true so we can assert the spinner
    vi.mocked(fetch).mockReturnValueOnce(new Promise(() => {}))
    render(<BiddingPanel {...defaultProps} />)
    await userEvent.click(screen.getByLabelText('Bid 0'))
    expect(screen.getByTestId('bid-submitting')).toBeInTheDocument()
    expect(screen.getByText('Placing bid…')).toBeInTheDocument()
  })

  it('keeps the spinner visible after a successful bid (prevents double-tap before Realtime unmounts)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 200 }))
    render(<BiddingPanel {...defaultProps} />)
    await userEvent.click(screen.getByLabelText('Bid 0'))
    expect(screen.getByTestId('bid-submitting')).toBeInTheDocument()
  })

  it('clears the spinner after a failed bid so the player can retry', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Invalid bid' }), { status: 422 })
    )
    render(<BiddingPanel {...defaultProps} />)
    await userEvent.click(screen.getByLabelText('Bid 0'))
    expect(screen.queryByTestId('bid-submitting')).not.toBeInTheDocument()
    expect(screen.getByText('Invalid bid')).toBeInTheDocument()
  })
})
