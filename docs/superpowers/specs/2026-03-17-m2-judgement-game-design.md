# M2 Design: Judgement — Fully Playable End-to-End

**Date:** 2026-03-17
**Status:** Approved
**Milestone:** M2 — Judgement fully playable

---

## Goal

Four or more friends can play a complete game of Judgement with correct rules, scoring, and game history saved. The game is reachable from the existing waiting room; no new auth or room infrastructure is needed.

**Done when:** Players can start a game, bid, play cards through all rounds, and see a final results screen with correct scores.

---

## Decisions Made

| Decision | Choice | Rationale |
|---|---|---|
| Game screen routing | Single `/game/[gameId]`, phase-conditional rendering | No re-subscription overhead; seamless in-game transitions |
| Realtime strategy | Postgres Changes only | Every meaningful event is a DB write; Broadcast not needed until M3 |
| Turn timer | Deferred to M3 (issue #17) | Requires server-side scheduler; M2 done condition does not require it |
| E2E testing | Slice-by-slice | Green suite at each slice; avoids large failing test throughout M2 |
| Round structure | Descending only — hand size decreases from starting count down to 1, no climb back | Simpler, fairer; game ends at the 1-card round |
| API cascade | Single `play` endpoint, server auto-advances | Fewer round trips; no race condition surface on round/game transitions |
| Turn order | Randomized at game start; stored as `seat_order` integers (0-indexed, gapless) on `room_players`; starting bidder for round N = seat index `(round_number - 1) % playerCount` | Fair, deterministic, no extra state |
| First trick leader each round | Same player who leads bidding that round — seat index `(round_number - 1) % playerCount` | Simple and consistent; no separate tracking needed |
| WaitingRoom redirect | `WaitingRoom` subscribes to `rooms` UPDATE; redirects when `status = 'in_progress'` | Room status is already source of truth — requires adding `rooms` to Realtime publication (see Schema Changes) |
| Hand tracking | `hands.cards` is **immutable** after dealing; current hand derived server-side as `dealt_cards − played trick_cards for this round` | Avoids JSONB mutation race conditions; consistent with existing schema comment |
| Hand delivery to client | `rounds` INSERT triggers client to call `GET /api/games/[gameId]/hand` | `hands` table excluded from Realtime — broadcasting hand data would expose cards to all subscribers |
| Game end detection | `GameBoard` subscribes to `games` UPDATE; on `status = 'finished'` navigates to `/game/[gameId]/results` — requires adding `games` to Realtime publication (see Schema Changes) |
| Results screen | Separate route `/game/[gameId]/results/page.tsx` — server component that fetches `game_results` fresh; bookmarkable, cleanly server-rendered | ResultsPanel as inline GameBoard render creates unnecessary Realtime state coupling for a read-only summary page |
| RLS for game tables | Read policies for `games`, `rounds`, `bids`, `tricks`, `trick_cards`, `round_scores`, `game_results` added in Slice 2 migration; `hands` excluded (server-side only) | Realtime subscriptions run under anon key — without policies clients receive no Postgres Changes events |
| Placement ranking | Dense ranking — ties share a placement; next distinct score gets next consecutive placement (1, 1, 2 not 1, 1, 3) | Avoids punishing players below a tie |

---

## Schema Changes Required (new migrations for M2)

The existing migration `20260317000000_realtime_game_tables.sql` already adds `rounds`, `bids`, `trick_cards`, `tricks`, and `round_scores` to the Realtime publication. Three further migrations are needed:

```sql
-- Migration: 20260317000001_realtime_rooms_games.sql
alter publication supabase_realtime add table rooms;
alter publication supabase_realtime add table games;

-- Migration: 20260317000002_rooms_current_game_id.sql
alter table rooms add column current_game_id uuid references games(id) on delete set null;

-- Migration: 20260317000003_game_rls_policies.sql
-- Authenticated players can read game data for rooms they are in.
-- hands is intentionally excluded — it is served via API route only.

create policy "Players can read games for their rooms"
  on public.games for select to authenticated
  using (
    exists (
      select 1 from public.room_players rp
      where rp.room_id = games.room_id
        and rp.user_id = auth.uid()
    )
  );

create policy "Players can read rounds for their games"
  on public.rounds for select to authenticated
  using (
    exists (
      select 1 from public.games g
      join public.room_players rp on rp.room_id = g.room_id
      where g.id = rounds.game_id
        and rp.user_id = auth.uid()
    )
  );

create policy "Players can read bids for their games"
  on public.bids for select to authenticated
  using (
    exists (
      select 1 from public.rounds r
      join public.games g on g.id = r.game_id
      join public.room_players rp on rp.room_id = g.room_id
      where r.id = bids.round_id
        and rp.user_id = auth.uid()
    )
  );

create policy "Players can read tricks for their games"
  on public.tricks for select to authenticated
  using (
    exists (
      select 1 from public.rounds r
      join public.games g on g.id = r.game_id
      join public.room_players rp on rp.room_id = g.room_id
      where r.id = tricks.round_id
        and rp.user_id = auth.uid()
    )
  );

create policy "Players can read trick_cards for their games"
  on public.trick_cards for select to authenticated
  using (
    exists (
      select 1 from public.tricks t
      join public.rounds r on r.id = t.round_id
      join public.games g on g.id = r.game_id
      join public.room_players rp on rp.room_id = g.room_id
      where t.id = trick_cards.trick_id
        and rp.user_id = auth.uid()
    )
  );

create policy "Players can read round_scores for their games"
  on public.round_scores for select to authenticated
  using (
    exists (
      select 1 from public.rounds r
      join public.games g on g.id = r.game_id
      join public.room_players rp on rp.room_id = g.room_id
      where r.id = round_scores.round_id
        and rp.user_id = auth.uid()
    )
  );

create policy "Players can read game_results for their games"
  on public.game_results for select to authenticated
  using (
    exists (
      select 1 from public.games g
      join public.room_players rp on rp.room_id = g.room_id
      where g.id = game_results.game_id
        and rp.user_id = auth.uid()
    )
  );
```

`current_game_id` is set by the `start` endpoint when creating the game and is included in every `rooms` UPDATE payload. This is how non-host players obtain the `gameId` for the redirect — they read it directly from the Realtime event payload.

`hands` must **not** be added to Realtime or given a public read policy — it is served only via `GET /api/games/[gameId]/hand` using the service-role client.

---

## Types to Add (`src/lib/game/types.ts`)

Before Slice 1, add:

```typescript
export interface TrickCard {
  playerId: string;
  suit: Suit;
  value: CardValue;
}

// Used by getTrickWinner and validatePlay to compare card values.
// Must live in types.ts so gameRules.ts and all tests share a single source.
export const CARD_RANK: Record<CardValue, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8,
  '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14,
};
```

---

## Round Structure

| Players | Starting hand size | Total rounds |
|---|---|---|
| 2–3 | 10 | 10 |
| 4–6 | 8 | 8 |
| 7 | 7 | 7 |
| 8 | 6 | 6 |
| 9–10 | 5 | 5 |

Sequence is always descending: `[startingHandSize, startingHandSize-1, ..., 1]`

Game ends after the round where `round_number = game.starting_hand_size`. The termination condition in code must be `round_number === game.starting_hand_size` — **not** `hand_size === 1` — to make the intent explicit and to be robust to future rule changes.

---

## Seat Order

`room_players.seat_order` is a single integer per player (0-indexed, gapless: 0, 1, 2, … n-1). The `start` endpoint assigns these by shuffling the active player list and writing the shuffled index back to each row.

To get the ordered player sequence:
```sql
SELECT user_id FROM room_players
WHERE room_id = X AND status = 'active'
ORDER BY seat_order ASC
```

To advance `current_player_id`: find the current player's `seat_order`, add 1, wrap with `% playerCount`, look up the player at that index.

Starting bidder for round N: player at seat index `(round_number - 1) % playerCount` — implemented as `getStartingBidderIndex(roundNumber, playerCount)` in `gameRules.ts`. The same player leads the first trick of that round (no separate tracking needed).

---

## Tricks Row Lifecycle

`tricks.winner_id` is nullable in the schema — this reflects a two-phase lifecycle:

1. **Trick start** (first card played in a trick): INSERT a `tricks` row with `winner_id = null`, `led_suit = null`, `trick_number = N`. All `trick_cards` rows reference this `trick_id`.
2. **Trick complete** (last card played): UPDATE the `tricks` row with the resolved `winner_id` and `led_suit`.

The `play` endpoint must create the `tricks` row before inserting the first `trick_cards` row, because `trick_cards.trick_id` is a non-nullable foreign key.

---

## Current Hand Derivation

The server derives a player's current hand for a round as:

```
current_hand = hands.cards (for this round, this player)
               MINUS
               trick_cards played by this player across ALL completed and in-progress tricks in this round
```

The query join path:
```sql
SELECT tc.suit, tc.value
FROM trick_cards tc
JOIN tricks t ON tc.trick_id = t.id
WHERE t.round_id = :round_id
  AND tc.player_id = :player_id
```

A common mistake is to subtract only the current trick's cards — this would leave cards from completed tricks still in the derived hand. Always join through `tricks` filtered by `round_id`.

---

## Game State Machine

```
rooms.status = 'waiting'
  ↓ POST /api/rooms/[code]/start  (host only)
    - Shuffle active players; assign seat_order 0..n-1
    - Create games row (status = 'in_progress', starting_hand_size)
    - Deal hands: shuffle 52-card deck, deal handSize cards to each player
      → insert hands rows (immutable; one row per player per round)
      → trump = top card of remaining deck; store in rounds row
    - Create rounds row (round_number=1, hand_size=startingHandSize, status='bidding',
        current_player_id = player at seat index 0)
    - Update rooms.status = 'in_progress', rooms.current_game_id = gameId
    - Returns: { gameId }

rounds.status = 'bidding'
  → POST /api/games/[gameId]/bid { amount }
    - Load current round; verify status = 'bidding', current_player_id = caller
    - Compute valid bids via getValidBids(hand_size, existingBids, isLastBidder)
    - Validate amount is in validBids
    - Insert bids row
    - Advance current_player_id to next in seat order
    - When bids count = playerCount:
        → rounds.status = 'playing'
        → current_player_id = player at getStartingBidderIndex(round_number, playerCount)
        → INSERT tricks row (round_id, trick_number=1, winner_id=null, led_suit=null)
          [This is the only place a new trick row is created — not in the start endpoint]
    - Returns: { ok: true }

rounds.status = 'playing'  [trick loop, repeats hand_size times]
  → POST /api/games/[gameId]/play { suit, value }
    - Load current round + current tricks row (latest by trick_number); verify status='playing', current_player_id=caller
    - Derive caller's current hand (see Current Hand Derivation above)
    - Validate card is in derived hand
    - Determine lead suit: first trick_cards row for current trick (null if none yet)
    - Validate play via validatePlay(card, derivedHand, leadSuit)
    - Insert trick_cards row (referencing current tricks.id)
    - If this is the first card of the trick: UPDATE tricks row with led_suit = card.suit
    - Advance current_player_id (next in seat order for this trick)
    - When trick_cards count for this trick = playerCount (trick complete):
        → Determine winner via getTrickWinner(trickCards, trumpSuit, leadSuit)
        → UPDATE tricks row: winner_id, led_suit (already set above but confirm)
        → If more tricks remain (completed tricks count < hand_size):
            - INSERT new tricks row (trick_number+1, winner_id=null, led_suit=null)
            - current_player_id = trick winner
        → If no tricks remain (completed tricks count = hand_size, i.e. round complete):
            - Compute tricksWon per player from tricks.winner_id
            - Compute scores via scoreRound(bids, tricksWon)
            - Insert round_scores rows
            - rounds.status = 'finished'
            - If round_number < game.starting_hand_size (more rounds remain):
                - Deal fresh 52-card deck for next round
                - Insert hands rows for next round (immutable)
                - Create rounds row (round_number+1, hand_size-1, status='bidding',
                    current_player_id = player at getStartingBidderIndex(round_number+1, playerCount))
            - If round_number = game.starting_hand_size (final round):
                - Compute final scores via tallyFinalScores(allRoundScores)
                - Compute placements via determinePlacements(finalScores)  [dense ranking]
                - Insert game_results rows (total_score, placement, result)
                - games.status = 'finished'
                - rooms.status = 'finished'
    - Returns: { ok: true }
```

---

## API Surface

All endpoints require authentication. All game state mutations use the admin client (service_role) to bypass RLS.

### `POST /api/rooms/[code]/start`
- Auth: host only
- Creates game, deals hands, sets trump, creates round 1, randomizes seat order
- Updates `rooms.status = 'in_progress'`
- Returns: `{ gameId: string }`

### `POST /api/games/[gameId]/bid`
- Body: `{ amount: number }`
- Validates bid legality via `gameRules.validateBid()`
- Inserts `bids` row, advances turn; transitions to `'playing'` when all bids in
- Returns: `{ ok: true }`

### `POST /api/games/[gameId]/play`
- Body: `{ suit: Suit, value: CardValue }`
- Derives current hand server-side (see Current Hand Derivation)
- Validates card legality via `gameRules.validatePlay()`
- Full cascade: trick completion → round scoring → next round creation or game end
- Returns: `{ ok: true }`

### `GET /api/games/[gameId]/hand`
- Returns only the authenticated player's **current** hand for the active round
- Derived server-side using the join query in Current Hand Derivation
- Called by client on initial page load and on each `rounds` INSERT (new round)
- Returns: `{ cards: Card[] }`

---

## Game Rules Module (`src/lib/game/gameRules.ts`)

Pure functions, zero framework dependencies. Fully unit-tested before any API route is wired.

```typescript
// Round structure
getStartingHandSize(playerCount: number): number
getRoundSequence(startingHandSize: number): number[]              // [8,7,...,1]
getStartingBidderIndex(roundNumber: number, playerCount: number): number  // (roundNumber-1) % playerCount

// Dealing — fresh 52-card deck each round, no duplicates guaranteed by sequential deal
dealHands(playerIds: string[], handSize: number): Record<string, Card[]>
drawTrump(deck: Card[]): { trumpCard: Card; trumpSuit: Suit; remaining: Card[] }

// Bidding
getValidBids(handSize: number, existingBids: number[], isLastBidder: boolean): number[]
// Returns [0..handSize] excluding the value where sum(existingBids)+amount = handSize (when isLastBidder)
validateBid(amount: number, validBids: number[]): boolean

// Card play
getLeadSuit(trickCards: TrickCard[]): Suit | null
canFollowSuit(hand: Card[], leadSuit: Suit): boolean
validatePlay(card: Card, hand: Card[], leadSuit: Suit | null): boolean
// Invalid if: card not in hand, OR (leadSuit != null AND canFollowSuit(hand, leadSuit) AND card.suit != leadSuit)

// Trick resolution — uses CARD_RANK from types.ts for value comparison
getTrickWinner(trickCards: TrickCard[], trumpSuit: Suit, leadSuit: Suit): string  // returns playerId
// Winner = highest CARD_RANK among trump cards if any played; else highest CARD_RANK of lead suit

// Scoring
// GOTCHA: bid=0 exact → 10 pts (not 0). Implement as: bid === 0 ? 10 : bid * 10
scoreRound(
  bids: Record<string, number>,
  tricksWon: Record<string, number>
): Record<string, number>

tallyFinalScores(roundScores: Array<Record<string, number>>): Record<string, number>

// Uses dense ranking: ties share placement, next rank is consecutive (1,1,2 not 1,1,3)
determinePlacements(
  totalScores: Record<string, number>
): Array<{ playerId: string; placement: number; result: GameResult }>
```

---

## UI Structure

### `WaitingRoom` — existing Client Component
- Add `rooms` UPDATE subscription
- On `status = 'in_progress'`: redirect all players to `/game/[gameId]`
- `gameId` comes from `event.new.current_game_id` in the Realtime payload — this works for both the host and non-host players since `rooms.current_game_id` is set by the `start` endpoint and included in every `rooms` UPDATE event

### `GamePage` — Server Component (`/game/[gameId]/page.tsx`)
- Fetches initial game state, current round, existing bids, current trick cards
- Fetches player's own current hand via server client
- Passes all to `<GameBoard>`

### `GameBoard` — Client Component
- Owns all Realtime subscriptions for the game screen (set up once; persist for entire session)
- Manages phase state derived from `rounds.status` and `games.status`
- On `rounds` INSERT: re-fetches player's hand via `GET /api/games/[gameId]/hand`
- On `games.status = 'finished'`: calls `router.push('/game/[gameId]/results')`
- Renders conditionally based on phase: `<BiddingPanel>` | `<TrickPanel>`
- Always renders: `<TrumpDisplay>`, `<PlayerHand>`, `<Scoreboard>`

### Realtime subscriptions

| Component | Table | Events | Effect |
|---|---|---|---|
| `WaitingRoom` | `rooms` | UPDATE | Redirect to `/game/[event.new.current_game_id]` when `status = 'in_progress'` |
| `GameBoard` | `rooms` | UPDATE | Detect unexpected cancellation; show error if `status = 'cancelled'` |
| `GameBoard` | `games` | UPDATE | Navigate to `/game/[gameId]/results` when `status = 'finished'` |
| `GameBoard` | `rounds` | INSERT, UPDATE | Phase transitions; trump card; current player; INSERT triggers hand refetch |
| `GameBoard` | `bids` | INSERT | Scoreboard bid column; last-bidder restriction UI |
| `GameBoard` | `trick_cards` | INSERT | Cards shown on table in TrickPanel |
| `GameBoard` | `tricks` | UPDATE | Trick winner announcement (on UPDATE when `winner_id` set); tricks-won count |
| `GameBoard` | `round_scores` | INSERT | Scoreboard totals after each round |

**Note:** `tricks` subscription uses UPDATE (not INSERT) because the row is created at trick start with `winner_id = null`; the winner is written on UPDATE when the trick completes.

### Component responsibilities

- **`TrumpDisplay`**: trump card + suit, round number, hand size — always visible
- **`BiddingPanel`**: bid input; shows valid range; highlights forbidden value for last bidder with explanation
- **`TrickPanel`**: cards played so far in current trick; whose turn it is
- **`PlayerHand`**: current user's cards; interactive (clickable) only on their turn during `playing` phase; on invalid play, card stays in hand and an error message is shown
- **`Scoreboard`**: cumulative scores, current-round bids, tricks won this round — always visible
- **`ResultsPanel`** (`/game/[gameId]/results/page.tsx`): server component; fetches `game_results` fresh; final standings with placements; winner(s) highlighted; "Play again" returns to home screen

---

## Testing Slices

Each slice ships with a green test suite before the next slice begins.

| Slice | What ships | Tests |
|---|---|---|
| 1 | `TrickCard` type + `CARD_RANK` in `types.ts`; `gameRules.ts` — all pure functions | Vitest unit tests: every function, every edge case (last-bidder restriction, trump beats lead suit, tie scores, 0-bid scoring, dense ranking) |
| 2 | Migration `20260317000001`; start game endpoint; WaitingRoom `rooms` subscription + redirect | E2E: host starts game, all players redirected to `/game/[gameId]` |
| 3 | Bid endpoint + BiddingPanel + Realtime | E2E: all players bid in order; last-bidder forbidden value shown and rejected; round transitions to `playing` |
| 4 | Play endpoint + TrickPanel + PlayerHand | E2E: cards played in order; follow-suit violation rejected with message and card stays in hand; trick winner resolved; next trick starts with winner leading |
| 5 | Round scoring + game loop | E2E: seed a 2-player, 1-round game (hand_size=1); complete the round; correct winner shown on ResultsPanel |
| 6 | Full game screen: GameBoard, Scoreboard, TrumpDisplay, ResultsPanel | E2E: multi-round game flow; scoreboard updates correctly after each round |

**Note on Slice 5 seeding:** The 2-player room can be created normally through the API — `max_players=2` is valid.

**Note on Slice 5 scope:** A full 8-round game is not tested in E2E — it is covered by `gameRules.ts` unit tests in Slice 1 and manual QA.

---

## Out of Scope for M2

- Turn timer auto-resolve (M3, issue #17)
- Disconnection handling (M3)
- Mobile polish (M3)
- Public rooms, leaderboard (M4)
- "How to Play" modal (M3 polish)
- `GET /api/game/state` full resync endpoint (define shape in M2, implement in M3)
