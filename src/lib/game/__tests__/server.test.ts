import { describe, it, expect, vi } from 'vitest'
import { getPlayerHand } from '../server'
import type { Card } from '../types'

function makeAdminClient({
  handCards = [{ suit: 'hearts', value: 'A' }, { suit: 'spades', value: 'K' }] as Card[] | null,
  trickIds = ['trick-1'] as string[],
  playedCards = [] as Array<{ suit: string; value: string }>,
} = {}) {
  const handMaybeSingle = vi.fn().mockResolvedValue({
    data: handCards !== null ? { cards: handCards } : null,
  })
  const handChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: handMaybeSingle,
  }

  const tricksSelect = vi.fn().mockResolvedValue({
    data: trickIds.map((id) => ({ id })),
  })
  const tricksChain = {
    select: vi.fn().mockReturnThis(),
    eq: tricksSelect,
  }

  const playedIn = vi.fn().mockResolvedValue({ data: playedCards })
  const playedChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: playedIn,
  }

  let callCount = 0
  return {
    from: vi.fn((table: string) => {
      if (table === 'hands') return handChain
      if (table === 'tricks') return tricksChain
      if (table === 'trick_cards') return playedChain
    }),
  }
}

describe('getPlayerHand', () => {
  it('returns empty array when no hand row exists', async () => {
    const admin = makeAdminClient({ handCards: null })
    const result = await getPlayerHand(admin as never, 'round-1', 'user-1')
    expect(result).toEqual([])
  })

  it('returns full hand when no tricks have been played', async () => {
    const hand: Card[] = [{ suit: 'hearts', value: 'A' }, { suit: 'clubs', value: '7' }]
    const admin = makeAdminClient({ handCards: hand, trickIds: [] })
    const result = await getPlayerHand(admin as never, 'round-1', 'user-1')
    expect(result).toEqual(hand)
  })

  it('returns remaining cards after subtracting played cards', async () => {
    const hand: Card[] = [
      { suit: 'hearts', value: 'A' },
      { suit: 'clubs', value: '7' },
      { suit: 'spades', value: 'K' },
    ]
    const played = [{ suit: 'hearts', value: 'A' }]
    const admin = makeAdminClient({ handCards: hand, trickIds: ['trick-1'], playedCards: played })
    const result = await getPlayerHand(admin as never, 'round-1', 'user-1')
    expect(result).toEqual([
      { suit: 'clubs', value: '7' },
      { suit: 'spades', value: 'K' },
    ])
  })

  it('returns empty array when all cards have been played', async () => {
    const hand: Card[] = [{ suit: 'hearts', value: 'A' }]
    const played = [{ suit: 'hearts', value: 'A' }]
    const admin = makeAdminClient({ handCards: hand, trickIds: ['trick-1'], playedCards: played })
    const result = await getPlayerHand(admin as never, 'round-1', 'user-1')
    expect(result).toEqual([])
  })
})
