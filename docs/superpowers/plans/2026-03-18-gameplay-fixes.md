# Gameplay Fixes Implementation Plan

> **SUPERSEDED — 2026-03-21:** All three tasks in this plan are complete. Lead suit validation uses `currentTrick.led_suit`, round winner correctly leads the next round via `winnerId`, and cards are uniformly `w-20 h-28`. See `docs/superpowers/plans/2026-03-21-m3-polish-and-disconnection.md` for current M3 work.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three bugs: card play validation using stale client state, round winner not leading the next round, and cards too small to read comfortably.

**Architecture:** Bug 1 is a client-side state problem — `leadSuit` is computed from potentially-stale `trickCards` instead of the server-authoritative `currentTrick.led_suit`. Bug 2 is a server-side routing bug — `bid/route.ts` and `play/route.ts` use a seat-order rotation for the first trick leader instead of tracking the previous round's winner. Bug 3 is pure UI: increase card dimensions and restructure card layout.

**Tech Stack:** Next.js App Router, Supabase, Vitest (unit tests), Tailwind CSS

---

## Root Cause Analysis

### Bug 1 — Card play restriction on first play of trick

`TrickPanel` computes `leadSuit` from `trickCards` (client-side React state):
```ts
const leadSuit = getLeadSuit(
  trickCards.map((tc) => ({ ...tc, suit: tc.suit as Suit, value: tc.value as CardValue }))
)
```
If the Realtime `tricks INSERT` event doesn't fire (known gap: Realtime is unreliable), `trickCards` retains cards from the **previous** trick. The new leader's `trickCards` prop is non-empty, so `leadSuit` is wrong, and suit-follow validation incorrectly restricts all cards that don't match the stale suit.

**Fix:** Use `currentTrick.led_suit` (server-written when the first card is played) as the canonical lead suit. It's always `null` until the first card of the trick is played, which is exactly the correct semantics.

### Bug 2 — Round winner should lead the next round

`bid/route.ts` (transition to playing) uses:
```ts
const startingIndex = (round.round_number - 1) % players.length
const leadingPlayerId = players[startingIndex].user_id
```
`play/route.ts` (creating the next round) uses:
```ts
const nextBidderId = playerIds[getStartingBidderIndex(nextRoundNumber, players.length)]
```
Both use seat-order rotation. The correct rule (PRD): the winner of the last trick of round N bids first AND plays first in round N+1.

**Fix:**
- In `play/route.ts`: when creating the next round, set `current_player_id: winnerId` (the last trick winner, already computed in that code path).
- In `bid/route.ts`: when transitioning to playing (last bidder branch), query the last completed trick of the previous round to find its winner. Use that as the first trick leader. Round 1 falls back to `getStartingBidderIndex`.

### Bug 3 — Cards too small

Cards are `w-12 h-16` (48×96px). The value and suit symbol are concatenated inline (`7♥`). Fix: increase to `w-20 h-28` (80×112px) and use a proper playing-card layout: value in the top-left corner, large suit symbol centered.

---

## File Map

| File | Change |
|------|--------|
| `src/app/game/[gameId]/GameShell.tsx` | Pass `led_suit` from `currentTrick` to TrickPanel; update card size/layout in read-only hand and trick display |
| `src/app/game/[gameId]/TrickPanel.tsx` | Accept `ledSuit: Suit \| null` prop instead of computing it; update card size/layout |
| `src/app/api/games/[gameId]/bid/route.ts` | Fix first trick leader: use previous round's last trick winner |
| `src/app/api/games/[gameId]/play/route.ts` | Fix next round's starting player: use `winnerId` instead of rotation |
| `src/app/api/games/[gameId]/bid/__tests__/route.test.ts` | Update / add tests for new leader logic |
| `src/app/api/games/[gameId]/play/__tests__/route.test.ts` | Add test: next round `current_player_id` is trick winner |

---

## Task 1: Fix lead suit validation (Bug 1)

**Files:**
- Modify: `src/app/game/[gameId]/TrickPanel.tsx`
- Modify: `src/app/game/[gameId]/GameShell.tsx`

No new unit tests needed — this is a prop-passing change; the logic is already tested in `gameRules.test.ts`.

- [ ] **Step 1: Update TrickPanel Props to accept `ledSuit`**

In `TrickPanel.tsx`, replace the `leadSuit` local computation with a prop:

```ts
interface Props {
  gameId: string
  round: Round
  hand: Card[]
  trickCards: TrickCardDisplay[]
  isMyTurn: boolean
  currentPlayerName: string | null
  onCardPlayed: (card: Card) => void
  handOnly?: boolean
  ledSuit: Suit | null   // ADD THIS — server-authoritative, null until first card played
}
```

Remove this line from the function body:
```ts
// DELETE:
const leadSuit = getLeadSuit(
  trickCards.map((tc) => ({ playerId: tc.playerId, suit: tc.suit as Suit, value: tc.value as CardValue }))
)
```

Replace all uses of `leadSuit` inside TrickPanel with `ledSuit` (the prop). Also remove the `getLeadSuit` import if it's now unused.

- [ ] **Step 2: Pass `ledSuit` from GameShell**

In `GameShell.tsx`, find the TrickPanel usage (inside `{isPlaying && currentTrick ? ...}`):

```tsx
<TrickPanel
  gameId={gameId}
  round={round!}
  hand={hand}
  trickCards={trickCards}
  isMyTurn={isMyTurn}
  currentPlayerName={currentPlayerName}
  onCardPlayed={handleCardPlayed}
  handOnly
  ledSuit={(currentTrick?.led_suit ?? null) as Suit | null}  // ADD THIS
/>
```

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Run tests**

```bash
npm test
```
Expected: all existing tests pass (no regressions).

- [ ] **Step 5: Commit**

```bash
git add "src/app/game/[gameId]/TrickPanel.tsx" "src/app/game/[gameId]/GameShell.tsx"
git commit -m "fix: use server-authoritative led_suit for card play validation"
```

---

## Task 2: Fix round winner leads next round (Bug 2)

**Files:**
- Modify: `src/app/api/games/[gameId]/play/route.ts`
- Modify: `src/app/api/games/[gameId]/bid/route.ts`
- Modify: `src/app/api/games/[gameId]/play/__tests__/route.test.ts`
- Modify: `src/app/api/games/[gameId]/bid/__tests__/route.test.ts`

### Part A: Fix `play/route.ts` — next round starting player

In `play/route.ts`, find the "Deal next round" section (inside `if (round.hand_size > 1)`):

```ts
// CURRENT (wrong):
const nextBidderId = playerIds[getStartingBidderIndex(nextRoundNumber, players.length)]

// REPLACE WITH:
// Winner of the last trick (this round's winner) bids first and plays first next round
const nextBidderId = winnerId
```

The `winnerId` variable is already computed above this point (from `getTrickWinner`). This also means `getStartingBidderIndex` is only used for round 1 (in `start/route.ts`), which is correct — round 1 has no previous winner.

- [ ] **Step 1: Write the failing test**

In `src/app/api/games/[gameId]/play/__tests__/route.test.ts`, add a test after the existing ones:

```ts
it('sets next round current_player_id to the trick winner, not seat rotation', async () => {
  // This test verifies the round-winner-leads-next-round rule.
  // Set up: last trick of round 1 (hand_size 2, trick_number 2 = last trick)
  // Player-2 wins the trick → player-2 should start round 2
  // ...
  // The existing mock structure should expose what was inserted into 'rounds'
  // Check: nextRound insert was called with current_player_id = winnerId
})
```

(Read the existing play route test file for the full mock structure before writing this. The mock captures `from('rounds').insert()` calls — inspect what `current_player_id` was passed.)

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/app/api/games/[gameId]/play/__tests__/route.test.ts --reporter=verbose
```
Expected: new test FAILS (current code uses rotation, not winner).

- [ ] **Step 3: Fix `play/route.ts`**

Locate the line:
```ts
const nextBidderId = playerIds[getStartingBidderIndex(nextRoundNumber, players.length)]
```

Replace with:
```ts
const nextBidderId = winnerId
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- src/app/api/games/[gameId]/play/__tests__/route.test.ts --reporter=verbose
```
Expected: all tests PASS.

### Part B: Fix `bid/route.ts` — first trick leader uses previous round winner

In `bid/route.ts`, inside the `if (isLastBidder)` block, replace:

```ts
// CURRENT (wrong — uses seat rotation):
const startingIndex = (round.round_number - 1) % players.length
const leadingPlayerId = players[startingIndex].user_id
```

With a lookup of the previous round's last trick winner:

```ts
// Find who leads the first trick: winner of round N-1's last trick.
// Round 1 has no previous round — fall back to seat-order rotation.
let leadingPlayerId: string
if (round.round_number === 1) {
  const startingIndex = getStartingBidderIndex(round.round_number, players.length)
  leadingPlayerId = players[startingIndex].user_id
} else {
  const { data: prevRound } = await admin
    .from('rounds')
    .select('id')
    .eq('game_id', gameId)
    .eq('round_number', round.round_number - 1)
    .maybeSingle()

  const { data: lastTrick } = prevRound
    ? await admin
        .from('tricks')
        .select('winner_id')
        .eq('round_id', prevRound.id)
        .not('winner_id', 'is', null)
        .order('trick_number', { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null }

  // Fall back to seat rotation if data is unavailable (defensive)
  leadingPlayerId = lastTrick?.winner_id
    ?? players[getStartingBidderIndex(round.round_number, players.length)].user_id
}
```

**Also update the import in `bid/route.ts` line 4** — `getStartingBidderIndex` is not currently imported there. Change:
```ts
// CURRENT:
import { getValidBids, validateBid } from '@/lib/game/gameRules'

// AFTER:
import { getValidBids, validateBid, getStartingBidderIndex } from '@/lib/game/gameRules'
```

Note: `gameId` is available in scope (it's extracted from params at the top of the route).

Also: after fixing `play/route.ts`, `getStartingBidderIndex` will no longer be used in that file (only `start/route.ts` now needs it for round 1). Remove the import from `play/route.ts` to avoid a lint warning.

- [ ] **Step 5: Write the failing test for bid route**

In `bid/__tests__/route.test.ts`, add a test that verifies that when the last bidder submits in round 2, the round transitions to playing with `current_player_id` set to the previous round's last trick winner (not the seat-rotation player).

**Important:** The new code path adds two DB queries inside the `isLastBidder` branch for `round_number > 1`:
1. `rounds.select().eq('game_id').eq('round_number', n-1).maybeSingle()` — fetches the previous round
2. `tricks.select().eq('round_id').not().order().limit().maybeSingle()` — fetches the last trick winner

The current `makeAdminMock` in `bid/__tests__/route.test.ts` has no `tricks` table entry and only one shape for `rounds` queries. You must extend the mock to handle:
- A second `rounds` SELECT (different chain shape: no `order`/`limit`)
- A `tricks` SELECT returning `{ data: { winner_id: 'player-2' } }`

Add parameters to `makeAdminMock` for `prevRoundId` and `lastTrickWinnerId`, defaulting to `null` (which keeps the round 1 fallback behaviour for existing tests).

- [ ] **Step 6: Run test to verify it fails**

```bash
npm test -- "src/app/api/games/[gameId]/bid/__tests__/route.test.ts" --reporter=verbose
```

- [ ] **Step 7: Apply the bid route fix above**

- [ ] **Step 8: Run all tests**

```bash
npm test
```
Expected: 138+ passed.

- [ ] **Step 9: Commit**

```bash
git add "src/app/api/games/[gameId]/play/route.ts" \
        "src/app/api/games/[gameId]/bid/route.ts" \
        "src/app/api/games/[gameId]/play/__tests__/route.test.ts" \
        "src/app/api/games/[gameId]/bid/__tests__/route.test.ts"
git commit -m "fix: round winner bids first and leads the first trick of the next round"
```

---

## Task 3: Larger, better-designed cards (Bug 3)

**Files:**
- Modify: `src/app/game/[gameId]/TrickPanel.tsx`
- Modify: `src/app/game/[gameId]/GameShell.tsx`

No new tests needed — pure visual change.

**Target card design:**
- Dimensions: `w-20 h-28` (80×112px) — large enough to read without squinting
- Layout: value in top-left (small, `text-sm font-bold`), large suit symbol centered (`text-4xl`)
- Colors: red for hearts/diamonds, `text-slate-900` (near-black) for clubs/spades
- Background: `bg-white` for valid/interactive; `bg-slate-700` for disabled/invalid
- Border radius: `rounded-xl` for a polished card look
- Valid + hoverable: `ring-2 ring-indigo-400` highlight when playable and it's your turn

**Card component template:**
```tsx
// Reusable card structure — use this in both TrickPanel and GameShell
<div className="relative w-20 h-28 rounded-xl bg-white shadow-md flex flex-col p-1.5 select-none">
  <span className={`text-sm font-bold leading-none ${suitColor}`}>{value}</span>
  <div className={`flex-1 flex items-center justify-center text-4xl ${suitColor}`}>
    {suitSymbol}
  </div>
</div>
```

For interactive (clickable) cards in TrickPanel, wrap in a `<button>` with:
- `hover:ring-2 hover:ring-indigo-400` when valid
- `opacity-40` when invalid (instead of changing background color)

For trick cards displayed in the center (GameShell): same card dimensions, no hover state.

- [ ] **Step 1: Update card rendering in TrickPanel**

Replace both the clickable hand card and the static hand card in TrickPanel with the new dimensions and layout described above.

Before: `w-12 h-16` with `{card.value}{SUIT_SYMBOL[card.suit]}` concatenated.
After: `w-20 h-28` with value top-left, large symbol centered.

- [ ] **Step 2: Update card rendering in GameShell**

Update three places in GameShell:
1. The read-only hand cards during bidding (currently `w-12 h-16`)
2. The trick cards in the center area (currently `w-12 h-16`)
3. The trump card visual (already `w-16 h-24` — increase to `w-20 h-28` for consistency)

- [ ] **Step 3: Visual check**

Start the dev server and verify:
- Cards in hand are comfortably readable
- Trump card matches the same design
- Trick area cards are the same size
- Invalid cards during suit-follow are visually distinct (opacity-40) but still visible

```bash
npm run dev
```

- [ ] **Step 4: Run tests**

```bash
npm test
```
Expected: 138+ passed (no regressions — tests don't assert on CSS classes).

- [ ] **Step 5: Commit**

```bash
git add "src/app/game/[gameId]/TrickPanel.tsx" "src/app/game/[gameId]/GameShell.tsx"
git commit -m "feat: larger card design with value + suit symbol layout"
```

---

## Task 4: Final merge and docs

- [ ] **Step 1: Run full test suite**

```bash
npm test
```
Expected: all tests pass.

- [ ] **Step 2: Type check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Merge to main**

```bash
git checkout main
git merge --no-ff feat/gameplay-fixes -m "feat: merge gameplay fixes — lead suit, round winner, card design"
git branch -d feat/gameplay-fixes
```

- [ ] **Step 4: Update CHANGELOG**

Add an entry under a new `[Post-M2 Gameplay Fixes]` section:

```markdown
### Fixed
- Card play validation now uses `led_suit` from the DB instead of client-side `trickCards`
  state, eliminating false suit-follow restrictions when Realtime drops the trick INSERT event
- Round winner now bids first and plays the first card of the following round (was using
  seat-order rotation instead of tracking the previous trick winner)

### Changed
- Playing cards resized from 48×64px to 80×112px with a proper corner-value + centered-suit
  layout for improved readability
```
