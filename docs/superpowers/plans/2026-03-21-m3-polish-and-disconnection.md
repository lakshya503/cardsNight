# M3: Polish & Disconnection Handling

> Supersedes: `docs/superpowers/plans/2026-03-18-gameplay-fixes.md` (all tasks complete as of 2026-03-21)

**Done when:** Drop-outs handled gracefully; works cleanly on mobile and desktop.

---

## Already Done (on `feat/m3-turn-timer`)

- `turn_started_at` column added to `rounds` table (migration + schema types)
- All API routes (`start`, `bid`, `play`) stamp `turn_started_at` on every turn advance
- Tests asserting ISO 8601 format on `turn_started_at`
- Bug fixes (confirmed in code): lead suit uses `currentTrick.led_suit`, round winner leads next round via `winnerId`, cards are `w-20 h-28`

---

## Issue Map

| # | Title | Branch | Status | Blocks |
|---|-------|--------|--------|--------|
| 1 | Turn timer countdown UI | `feat/m3-turn-timer-ui` | pending | — |
| 2 | expire-turn endpoint | `feat/m3-turn-timer` | pending | 1, 5 |
| 3 | Disconnection detection via Presence | `feat/m3-disconnect` | pending | 4, 5, 6 |
| 4 | Reconnection countdown banner | `feat/m3-disconnect` | pending | 5 |
| 5 | Dropped player auto-resolution | `feat/m3-drop-player` | pending | 6, 7 |
| 6 | Game result on intentional leave | `feat/m3-drop-player` | pending | 7 |
| 7 | Game history / profile stats | `feat/m3-profile` | pending | — |
| 8 | Mobile responsive audit & fixes | `feat/m3-mobile` | pending | — |
| 9 | UX polish | `feat/m3-ux-polish` | pending | — |

---

## Issue 2 — expire-turn endpoint *(build first — no UI deps)*

**File:** `src/app/api/games/[gameId]/expire-turn/route.ts` (new)

`POST /api/games/[gameId]/expire-turn`

1. Auth check + verify active player in game
2. Fetch `round.turn_started_at` + `room.turn_timer_seconds`
3. If `now < expiredAt - 1500ms` → return `{ status: 'not_expired' }` (idempotent guard)
4. **Bidding:** `getValidBids()` → `Math.min(...validBids)` → insert bid → advance turn (same flow as `bid/route.ts`)
5. **Playing:** fetch hand from DB → lowest legal card respecting suit-follow (`validatePlay` + `CARD_RANK` from `gameRules.ts`) → insert trick_card → advance turn
6. Stamps `turn_started_at` for next player
7. Idempotent: second call finds round already advanced, returns gracefully

Unit tests: not-expired guard, auto-bid (including last-bidder restriction), auto-play suit-follow and off-suit fallback.

Helpers to reuse: `getValidBids`, `validatePlay`, `CARD_RANK` from `src/lib/game/gameRules.ts`

---

## Issue 1 — Turn timer countdown UI

**Files:** `src/app/game/[gameId]/GameShell.tsx`, new `src/app/game/[gameId]/TurnTimer.tsx`

- Reads `round.turn_started_at` + `room.turn_timer_seconds` (thread from `page.tsx`)
- Only renders when `turn_timer_seconds` is non-null
- Color grades: green >60%, amber 30–60%, red <30%, pulsing animation <10s
- Resets on `round.turn_started_at` Realtime UPDATE
- At 0: calls `POST /api/games/[gameId]/expire-turn` — one client fires via `useRef` guard

Unit test: correct color class at each threshold.

---

## Issues 3–6 — Disconnection Chain

### Issue 3 — Presence disconnect detection

**Files:** `src/app/game/[gameId]/GameShell.tsx`, `src/app/api/games/[gameId]/disconnect/route.ts` (new)

- Join Presence channel `presence:room:${gameId}` with `{ userId }` in GameShell
- On Presence `LEAVE`: first detecting client calls `POST /api/games/[gameId]/disconnect`
- Disconnect route: `WHERE status = 'active'` conditional update → `status = 'disconnected'`, `disconnected_at = now()`
- Broadcasts Supabase Broadcast on `game:${gameId}` for all clients

### Issue 4 — Reconnection countdown banner

**Files:** `src/app/game/[gameId]/GameShell.tsx`, new `src/app/game/[gameId]/ReconnectionBanner.tsx`

- Subscribes to Broadcast from Issue 3 + Presence LEAVE directly
- "PlayerName disconnected — 60s to reconnect" with live countdown
- Dismisses on `room_players UPDATE` with `status = 'active'`
- At 0: shows toast "PlayerName was dropped"
- State: `disconnectedPlayers: Map<userId, disconnectedAt>` in GameShell

### Issue 5 — Dropped player auto-resolution

**Files:** `src/app/api/games/[gameId]/drop-player/route.ts` (new), reuses Issue 2 helpers

- `POST /api/games/[gameId]/drop-player` — called by detecting client when banner hits 0
- Server enforces 60s: `disconnected_at` must be ≥ 60s ago
- Conditional: `WHERE status = 'disconnected'` (idempotent)
- If dropped player's turn: auto-resolve via Issue 2 helpers
- Insert `game_results`: `result = 'loss'`, `total_score` from current scores

### Issue 6 — Result recording on intentional leave

**Files:** `src/app/game/[gameId]/GameShell.tsx`, `src/app/api/games/[gameId]/leave/route.ts` (new), `src/app/game/[gameId]/results/page.tsx`

- `beforeunload` in GameShell calls `/leave` (reuses disconnect logic, bypasses Presence delay)
- Results page repair pass: insert missing `game_results` rows as `result = 'loss'` for any `active` players with no row when game is `finished`

---

## Issue 7 — Game history / profile stats page

**Files:** `src/app/profile/page.tsx` (new), home page header

- Server component; reads `game_results` joined with `games`
- Stats: total games, win rate, most recent date
- History list: game type, date, result, score, placement (reverse chronological)
- Empty state: "No games played yet"
- Profile link in home header

---

## Issues 8–9 — Polish (independent, parallel)

### Issue 8 — Mobile responsive audit

Viewport target: 375px–430px. Audit: hand overflow, opponent row, scoreboard, bid grid, round summary overlay, touch targets (≥ 44×44px). Fix with responsive Tailwind classes. Add Playwright snapshots at 375px for bidding + playing states.

### Issue 9 — UX polish

1. Game page load skeleton (no empty flash)
2. Bid submit spinner (currently just `opacity-50`)
3. Card play error auto-dismiss after 4s
4. Results page empty/error state for unknown game ID
5. "How to Play" button in game header → rules modal (static text, PRD requirement)

---

## Architecture Constraints

- **Auto-resolution is centralized:** expire-turn and drop-player both call the same `gameRules.ts` helpers. No duplication.
- **Server enforces expiry:** client calls the endpoint; `now - turn_started_at >= turn_timer_seconds` is checked server-side.
- **Idempotent disconnect route:** multiple clients may detect the same LEAVE; `WHERE status = 'active'` ensures only one write succeeds.
- **Admin client pattern:** all routes use `createAdminClient()` after `supabase.auth.getUser()` — follow `bid/route.ts` and `play/route.ts`.
