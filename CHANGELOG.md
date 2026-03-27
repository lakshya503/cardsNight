# Changelog

All notable changes to cardsNight are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Dev Tooling] — 2026-03-27

### Added
- `code-reviewer` and `scalability-reviewer` Claude Code agents (both Haiku) for correctness and scalability review — invoked within Claude Code sessions after each commit, no separate API key required
- Pre-commit hook blocks commits if `npm test` fails
- GitHub Actions CI runs `npm test` on every push; `Tests` is a required status check blocking merges to `main`; direct pushes to `main` blocked via branch protection
- `SessionStart` hook warns at session open if any open PR has failing CI checks

### Fixed
- Guest sign-in via invite link now redirects to the room destination — `signInAsGuest` reads a hidden `next` field from the form and validates it before redirecting instead of always sending guests to `/`

---

## [M3 — Play as Guest] — 2026-03-25

### Added
- "Play as Guest" option on the sign-in page — enter a display name, click the button, and get an anonymous Supabase session immediately; no Google account required
- `validateGuestName` utility enforces a Unicode-safe allowlist (letters, digits, spaces, apostrophes, hyphens, periods; max 24 chars) to prevent HTML injection in display names
- Guests see a "Playing as guest" banner on their profile page; stats and game history sections are hidden for anonymous users
- DB trigger patched to handle anonymous users: `coalesce(nullif(trim(full_name), ''), email, 'Guest')` so anonymous rows satisfy the NOT NULL constraint on `profiles.display_name`

---

## [M3 — Game Header Polish] — 2026-03-25

### Added
- Game header now shows "{Name} opens bidding" at the start of each bidding phase; disappears once the first bid is placed

### Changed
- Removed "N cards this round" label from game header — card count is visible from the hand itself
- How to Play button now has a surface background and border, making it more visually prominent

### Fixed
- `Round.status` typed as `RoundStatus` union throughout (was `string`); both SSR and realtime paths now narrow the DB wire value correctly

---

## [M3 — Concurrent Starts Guard + UX Polish] — 2026-03-25

### Fixed
- Concurrent double-taps on "Start game" no longer create two game rows — the start endpoint now calls a `claim_room_start` Postgres RPC that atomically transitions room status; the second caller gets 422 (#37)
- Results page `<main>` now uses `var(--color-background)` / `var(--color-text)` tokens instead of hardcoded `bg-slate-900`

### Added
- Game page loading skeleton renders while server component fetches (#52)
- Bid submit shows spinner + "Placing bid…" label during network request (#52)
- Card play error auto-dismisses after 4 seconds (#52)
- Results page shows readable error UI for unknown game IDs or access-denied instead of silent redirect (#52)
- Profile page at `/profile` with win rate, game count, and full game history (#50)

---

## [M3 — Reconnect, Scoring, and How to Play] — 2026-03-25

### Added
- "How to play?" button in the game header opens a game-type aware modal with Judgement rules; adding a second game requires only a new rules component and one switch case (`HowToPlayModal`, `JudgementRules`)
- `--color-overlay` design token for modal backdrop opacity

### Fixed
- Players who lose connection mid-game and rejoin via room code are now redirected straight back into the game instead of hitting a "game already started" wall
- Disconnected players (within the 60s reconnection window) are scored normally for the round — their auto-played turns count; zero-score penalty only applies to fully dropped players
- Dropped players attempting to rejoin now see "You were dropped from this game" instead of a generic "already in this room" error
- Players rejoining a finished game see "This game has already finished" instead of a generic error

---

## [M3 — Bug Fixes from Customer Feedback] — 2026-03-25

### Fixed
- Trump cards in hand no longer lose their glow when hovered — `hover:ring-2` was resetting the `box-shadow` (trump glow) via Tailwind's ring shadow mechanism; hover ring is now skipped for trump cards, with `cursor-pointer` and the existing lift animation providing playability feedback (#55)
- Bid panel buttons no longer spread apart as rounds progress — `flex justify-between` was distributing extra space evenly, so fewer buttons (smaller hand size) meant more gap; changed to `flex-wrap gap-2` for consistent spacing (#56)

---

## [M3 — Feedback Widget] — 2026-03-25

### Added
- Floating feedback button rendered globally in the app layout — visible only to authenticated users
- `submitFeedback` server action: validates input (type, text length, screenshot count/size), rate-limits to 5 submissions per user per 24h, uploads screenshots to a private Supabase Storage bucket with 30-day signed URLs, AI-filters garbage with Claude Haiku (fail-open on API error), creates a GitHub issue with `customer-reported-issue` or `customer-suggestion` label, and sends a confirmation email via Resend
- `feedback_submissions` Supabase table for rate limit tracking; RLS enabled, service-role access only
- `feedback-screenshots` private Supabase Storage bucket with upload policy
- GitHub labels `customer-reported-issue` and `customer-suggestion` created in the repo
- SessionStart hook (`check-feedback-issues.js`) — surfaces new customer feedback issues at the start of each Claude Code session, comparing against a `feedback-last-seen.txt` timestamp

---

## [M3 — Mobile Responsive Audit & UX Polish] — 2026-03-22

### Fixed
- `ResultsPanel`, `BiddingPanel` — hardcoded `#F5B800`/`#13131F` colors replaced with `var(--color-primary)` / `var(--color-text-on-primary)`
- `GameShell`, `TrickPanel` — all remaining hardcoded hex/rgba replaced with design tokens: `--color-suit-dark`, `--color-suit-warm`, `--color-surface-raised`, `--color-primary-light`, `--color-error`, `--color-text-on-accent`; trump card glow extracted to `--shadow-trump-glow` CSS token
- `GameShell` — leave/confirm button touch targets raised (`py-1` → `py-2`); top-level Leave trigger also given touch padding
- `WaitingRoom` — room code text size `text-5xl` → `text-3xl sm:text-5xl` to prevent overflow on 375px viewports
- `Scoreboard` — `max-h-48` raised to `max-h-64` to show all rows in 8–10 player games without scrolling
- `rooms/new`, `rooms/join` — form card padding `p-10` → `p-6 sm:p-10` for comfortable layout on mobile
- `rooms/new` — range slider accent `accent-indigo-500` → `accent-[var(--color-primary)]` (brand yellow)
- `layout.tsx` — added `Viewport` export with `viewportFit: 'cover'` for notched device safe-area insets

---

## [M3 — Profile / Game History] — 2026-03-22

### Added
- `/profile` page — stats strip (games played, wins, win rate, last played) and reverse-chronological game history list; placement 0 rows show "Left" badge with no placement number; empty state with link to home
- Home header — avatar + display name wrapped as a link to `/profile`; explicit "Profile" text link added alongside the sign out button
- `extractGame` + `computeStats` pure helpers (module-scoped, exported) with full unit test coverage: 16 tests covering null/undefined/scalar/array inputs, win rate edge cases, lastPlayed max logic, and array-typed Supabase relation normalisation

---

## [M3 — Intentional Leave] — 2026-03-22

### Added
- `POST /api/games/[gameId]/leave` — marks caller as `dropped`; upserts `game_results` row with `result = 'loss'`, `placement = 0`, and cumulative `total_score` scoped to this game; calls `resolveDroppedTurnChain` to advance the game if it was their turn; idempotent (conditional UPDATE returns `already_dropped` if caller already dropped)
- `GameShell` header — explicit two-step "Leave" → confirm → "Yes, leave" button; replaces the removed `beforeunload` listener (which fired on hard reload, causing unintentional losses); `leavePending` state resets on round transitions and overlay dismissals
- `results/page.tsx` — access control extended to `dropped` players; repair pass writes missing `game_results` rows for disconnected/dropped players when `game.status = 'finished'` (safety net for network failures); results queried after repair pass so newly-inserted rows appear
- `ResultsPanel` — dropped players (placement 0) render `—` for placement and `Left game` for result label; sorted to appear after all finished players

---

## [M3 — Dropped Player Auto-Resolution] — 2026-03-21

### Added
- `POST /api/games/[gameId]/drop-player` — marks a disconnected player as dropped after the 60s reconnection window; 60s server-side enforcement via `disconnected_at`; conditional UPDATE `WHERE status = 'disconnected'` (idempotent); self-drop guard returns 400; inserts `game_results` row with `result = 'loss'` and cumulative `total_score` scoped to this game only; idempotency check skips insert if row already exists
- `src/lib/game/autoResolve.ts` — shared auto-resolution module extracted from `expire-turn`; exports `autoResolveBid`, `autoResolvePlay`, and `resolveDroppedTurnChain`; player list derived from `hands` table for correct counts (includes dropped players dealt into the round); dropped players filtered from `round_scores` inserts and next-round dealing; `resolveDroppedTurnChain` loops with atomic claim lock to advance through consecutively dropped players
- `GameShell` seeds `droppedPlayers` state from server (page now fetches `status = 'dropped'` room players and passes `initialDroppedPlayers` prop); `onExpired` calls `drop-player` endpoint with 5s retry on `too_early` response; `expire-turn` client-side polling for dropped players removed — server resolves turns directly

### Changed
- `expire-turn` route delegates bid/play resolution to `autoResolve.ts`; `autoResolveBid`/`autoResolvePlay` fixed to derive player list from `hands` table, correcting `isLastBidder` denominator and trick-completion count for dropped-player scenarios
- Player query in `page.tsx` expanded to include `disconnected` players so disconnected players appear in scoreboard and player map during the reconnection window

### Fixed
- Pre-existing TypeScript errors: missing `afterEach` import, `unknown` cast in start route test, `departed` narrowing in Presence leave handler
- Vitest file discovery excluded `.claude/worktrees/` to prevent test duplication across git worktrees

---

## [M3 — Reconnection Banner] — 2026-03-21

### Added
- `ReconnectionBanner` component — 60s countdown from `disconnected_at`; urgent red styling when <10s remain; fires `onExpired` immediately at mount if window already elapsed; resets correctly when `disconnectedAt` prop changes (second disconnect); NaN guard for invalid date strings
- `GameShell` renders `ReconnectionBanner` for each entry in `disconnectedPlayers`; server-stamped `disconnected_at` overwrites optimistic client timestamp after fetch resolves; per-leave `optimisticTs` token prevents leave→rejoin→leave race from writing stale timestamp
- Presence channel retries on `CHANNEL_ERROR` / `TIMED_OUT` (mirrors Postgres channel pattern); `presenceChannel` assigned before `.subscribe()` to prevent stale reference on retry; `active` flag guards all async callbacks; retry attempt also applies server-confirmed timestamp on success

---

## [M3 — Disconnect Detection] — 2026-03-21

### Added
- `POST /api/games/[gameId]/disconnect` — marks a player as disconnected via conditional UPDATE `WHERE status = 'active'`; stamps `disconnected_at`; idempotent (0 rows updated → returns `already_disconnected`); self-disconnect guard returns 400
- `GameShell` Presence channel — joins `presence:game:${gameId}` on mount, tracks own `userId` as heartbeat; on `LEAVE` event fires the disconnect endpoint for the departing player (first caller wins; concurrent calls are no-ops via the conditional UPDATE); channel stored in outer scope for proper cleanup on unmount

---

## [M3 — Turn Timer] — 2026-03-21

### Added
- `turn_started_at` column on `rounds` table (migration `20260321000000_add_turn_started_at.sql`); stamped on every turn advance in `bid`, `play`, and `expire-turn` routes
- `TurnTimer` component — color-coded countdown (green >60%, amber 30–60%, red <30%), pulse animation <10s remaining; `useRef` guard fires `expire-turn` endpoint exactly once per turn; resets on `turn_started_at` change
- `POST /api/games/[gameId]/expire-turn` — server-side timer validation with 1500ms clock-skew grace; atomic claim guard via conditional `UPDATE WHERE turn_started_at = $original` prevents concurrent double-resolution; auto-bid (lowest biddable per restriction rule via `getValidBids()`); auto-play (lowest legal card with suit-follow via `pickLowestLegalCard()`)
- `GameShell` wired to `TurnTimer`; polling fallback now tracks `turn_started_at` drift so missed Realtime events don't leave the timer stale
- `page.tsx` fetches `turn_timer_seconds` from `rooms` and passes it to `GameShell`

---

## [Hand Size: 2–3 Players] — 2026-03-20

### Changed
- Starting hand size for 2–3 player games reduced from 10 to 8 cards, matching the 4–6 player rule.
  All 2–6 player games now start with 8 cards. Shortens a 2–3 player game from 10 rounds to 8.

---

## [Framer Motion Animations] — 2026-03-19

### Added
- **Framer Motion v12** installed as the animation library for all dynamic game moments
- **Card fly from hand to center** (`layoutId` shared element transition) — when the current player plays a card, it glides from their hand to the trick center; other players see a scale-in entrance
- **Trick sweep** — trick cards arc toward the winner with rotation and scale on resolution, replacing the plain CSS translate
- **Hand repositioning** (`layout` prop) — remaining hand cards slide smoothly into new positions after a card is played, during both bidding and playing phases
- **Player join animation** (`AnimatePresence`) — player rows slide in on join and fade out on drop in the waiting room lobby
- **Results page staggered reveal** — standings reveal one by one (150ms stagger, spring physics); first-place row gets a scale pulse and amber highlight; heading and back button animate in sequence

---

## [Scoring Formula Update] — 2026-03-19

### Changed
- Scoring formula updated from `10 × bid` (with bid-0 special-cased to 10) to `10 + (10 × bid)`
  for all exact bids. bid 0 = 10 pts, bid 1 = 20 pts, bid 3 = 40 pts, etc. This eliminates
  the parity between bid 0 and bid 1, and incentivizes higher bids throughout the game.

---

## [RLS Recursion Fix] — 2026-03-19

### Fixed
- **Root cause (all Realtime + REST failures)**: `room_players: room members can read` RLS policy
  queried `room_players` inside its own `USING` clause → Postgres error 42P17 (infinite recursion)
  on every evaluation. Every other table's policy joins through `room_players` (`rounds → games →
  room_players`, `bids → rounds → games → room_players`, etc.), so the recursion made ALL SELECT
  queries return 500 and Supabase Realtime event delivery fail silently. Fixed by introducing a
  `SECURITY DEFINER` function `is_room_member()` that reads `room_players` bypassing RLS; the
  policy now calls this function instead of querying the table directly.

---

## [Realtime Fix] — 2026-03-19

### Fixed
- **Root cause (Realtime)**: Supabase Realtime events silently blocked by RLS. `createBrowserClient` from `@supabase/ssr` only calls `realtime.setAuth()` on auth state transitions (SIGNED_IN / TOKEN_REFRESHED). Existing cookie sessions on page load fire no state change, so the WebSocket connected without a JWT — `auth.uid()` evaluated to null for all RLS policy checks and zero events delivered even though channels showed SUBSCRIBED. Fixed by calling `supabase.auth.getSession()` + `supabase.realtime.setAuth(token)` before subscribing.
- **Root cause (polling)**: `refreshPlayers()` browser-side Supabase query also silently failed because `createBrowserClient` did not correctly pick up the auth session cookie in production, returning null data and leaving player state stale. Fixed by switching WaitingRoom polling and Realtime room_players handler to `router.refresh()` — the server-side path always has correct auth via middleware cookies. Added sync `useEffect` (`playerKey` key) so refreshed `initialPlayers` prop flows into client `players` state.
- GameShell sync effect now also triggers on `current_player_id` and `status` changes so polling-triggered `router.refresh()` calls actually update the UI (was only keyed on round `id`).
- GameShell Realtime channel retries on CHANNEL_ERROR/TIMED_OUT (2s delay); polling fallback reduced from 8s to 3s
- WaitingRoom subscribe callback logs channel errors (3s polling covers failures)

---

## [M2] — Judgement Fully Playable — 2026-03-18

M2 goal: 4+ friends play a complete game of Judgement with correct rules, scoring, and history saved.

### Added
- `POST /api/rooms/[code]/start` — starts game, assigns seats, deals hands, flips trump, creates first round and trick
- `POST /api/games/[gameId]/bid` — validates turn order and restriction rule; transitions round to playing after last bid
- `GET /api/games/[gameId]/hand` — returns authenticated player's current hand (dealt cards minus played)
- `POST /api/games/[gameId]/play` — validates card play (suit-follow rule), updates trick state, resolves trick winner; after last trick: scores round, starts next round or ends game
- Full round lifecycle: `bidding → playing → complete`; game lifecycle: `in_progress → finished`
- `scoreRound` and `determinePlacements` game logic (exact bid = 10 + (10 × bid), miss = 0; dense ranking) — see [Scoring Formula Update] for the formula change made post-M2
- `dealHands` and `drawTrump` called server-side per round; hands stored in immutable `hands` table rows
- Game page (`/game/[gameId]`) — Server Component with full initial state (round, bids, hand, trick, cumulative scores)
- `GameShell` client component — stable Realtime channel subscriptions for all game tables; uses refs to avoid stale closure / channel teardown on state change
- `BiddingPanel` — bid button grid with forbidden-value warning (restriction rule enforced client-side)
- `TrickPanel` — card grid with suit-follow highlights; optimistic card removal on play
- `Scoreboard` — cumulative scores sorted descending, updated via `round_scores` Realtime events
- Results page (`/game/[gameId]/results`) — final rankings with placement, name, score; `data-testid="results-panel"`
- E2E auth helpers (`createTestUser`, `deleteTestUser`, `signIn`) using `POST /api/test/auth` (dev-only) to set session cookies in Playwright page contexts
- E2E game helpers (`createRoom`, `joinRoom`, `startGame`, `placeBid`, `getHand`, `playCard`, `playFullGame`)
- E2E test suites: `bidding.spec.ts` (3 tests), `play.spec.ts` (3 tests), `full-game.spec.ts` (2 tests including full 10-round game)
- Supabase migration: `REPLICA IDENTITY FULL` on `bids` and `tricks` for Realtime UPDATE/DELETE payloads

### Configuration
- `playwright.config.ts` loads `.env.local` via dotenv so Supabase keys are available in test env

### Chore
- Upgraded Node.js from 20.16.0 to 20.20.1 via `brew install node@20` (unit tests require 20.19+)

### Refactored (post-M2 cleanup)
- `leave/route.ts`: switched room DB query to admin client (consistent with M2 pattern)
- `Scoreboard.tsx`: removed `currentTricksWon` field that was never populated (always showed "0/N tricks"); replaced with "bid N" display; tricks-won tracking deferred to M3
- `GameShell.tsx`: removed dead `round_id?: string` from `Round` interface
- E2E `bidding.spec.ts`, `play.spec.ts`: removed local `adminClient`/`getCurrentRound`/`getPlayerHand` duplicates in favour of shared helpers
- E2E all spec files: added `cleanupRoom()` in `afterAll` so rooms, games, rounds, tricks, bids, hands, and scores no longer accumulate across test runs

### Fixed (post-M2 E2E stability)
- Middleware excluded from `/api` routes — was calling `getUser()` on every API request, doubling Supabase Auth calls and hitting free-tier rate limits under E2E load
- `POST /api/rooms/[code]/join` switched all DB queries to admin client — self-referential RLS policy on `room_players` caused 500 errors for guests not yet in a room
- Full-game E2E tests now run serially (shared `full-host`/`full-guest` users were getting sessions invalidated by concurrent signIns)
- `getHand` helper now throws on non-2xx instead of silently returning `[]` (was masking auth errors as undefined-card crashes)
- `playCard` helper retries once on 500 for transient Supabase TLS drops (`UND_ERR_SOCKET`)
- `playFullGame` uses direct admin DB reads for hand state instead of 110 auth-checked HTTP calls, cutting full-game test time from 5+ min to ~2 min
- Fixed email format for test users (`test-{label}@cardsnight.test`) with upsert fallback to avoid Supabase Auth burst rate limits across parallel workers
- Local E2E workers reduced from 4 to 2

---

## [Post-M2 Gameplay Fixes] — 2026-03-18

### Fixed
- Card play validation now uses `led_suit` from the DB instead of client-side `trickCards` state,
  eliminating false suit-follow restrictions when Realtime drops the trick INSERT event
- Round winner now bids first and plays the first card of the following round (was using
  seat-order rotation instead of tracking the previous trick winner)

### Changed
- Playing cards resized from 48×64px to 80×112px with a proper corner-value + centered-suit
  layout for improved readability

---

## [Deployment Prep] — 2026-03-19

### Fixed
- `MIN_PLAYERS` reverted from dev-only value of `2` back to `4` (PRD minimum); updated related unit tests
- `[RT]` Realtime diagnostic logs gated behind `NODE_ENV === 'development'` — were logging all game state to browser console in production
- Realtime channel torn down on every render: `playerMap` (computed inline) was in the `useEffect` dep array causing the channel to tear down and re-subscribe on every state update; fixed with `useMemo` and `playerMapRef`

### Added
- `NEXT_PUBLIC_SITE_URL` env var required for production OAuth callback — must be set in Vercel to the deployed app URL (fallback of `http://localhost:3000` is safe for local dev only)

---

## [Player Count Range 2–8] — 2026-03-19

### Changed
- Player range narrowed to 2–8 (was 4–10). Allows 2-player testing and removes
  unrealistic 9–10 player complexity. Hand size logic for 9–10 players removed as dead code.

---

## [M2 Gameplay Polish] — 2026-03-19 (ongoing)

### Fixed
- Realtime channel was torn down and re-subscribed on every state update because `playerMap` (computed inline via `Object.fromEntries`) produced a new object reference each render and was listed in the `useEffect` dep array. Fixed by memoizing with `useMemo([players])` and using a `playerMapRef` inside the handler. This was almost certainly the root cause of events being dropped and requiring manual refresh.
- Added `[RT]` diagnostic console logging to all Realtime handlers and the subscribe callback so connection status and event flow are visible in the browser console during development
- Round summary overlay was being dismissed before the user saw it — `router.refresh()` (triggered by `rounds INSERT` Realtime event) ran the `useEffect` sync which called `setShowRoundSummary(false)`. Fixed by snapshotting `tricksWon` and `bids` into frozen summary state at round-complete time; overlay now uses snapshot data and is only dismissed by explicit user tap
- `rounds.status` Postgres CHECK constraint had `'finished'` but server wrote `'complete'` — every round completion was silently failing with a 500. Fixed via migration `20260319000000_fix_rounds_status_constraint.sql` (applied to live DB); constraint now allows `('bidding', 'playing', 'complete')`
- "Starting trick" screen persisted after round transition — two causes: (1) `useState` initial values don't update when `router.refresh()` brings new props; fixed with `useEffect` keyed on `initialRound?.id` that resets all per-round state. (2) `tricks INSERT` Realtime events occasionally dropped mid-round; fixed with active Supabase client fallback fetch after each trick resolution

### Added
- Tricks-won tracking per player per round via `tricks UPDATE` Realtime events (`winner_id` field)
- Progress bar replacing N/M text badge under player names and opponents — green fill toward bid goal, amber if over bid, special display for bid=0
- End-of-round summary overlay on round complete — shows each player's tricks/bid, round score (`+N`), and running total; frozen snapshot data so it stays correct even as next round loads
- "Continue to next round →" button on round summary; overlay stays until explicitly dismissed
- Trump suit highlight — full amber ring + outer glow (`ring-2 ring-amber-400 shadow-[0_0_14px_3px_rgba(251,191,36,0.55)]`) on trump-suited cards in hand, applied during bidding, waiting, and play phases
- Unit test: last trick of last round (hand_size=1) → `game_complete` response and `game_results` insert
- Supabase migration: fix `rounds_status_check` constraint to use `'complete'` instead of `'finished'`

### Changed
- Card trick animation: 700ms pause (so all players can see the played cards) before 700ms CSS translate toward winner — was immediate
- Card value font size bumped from `text-sm` to `text-base` across all card renders (trump display, trick center, hand)
- Status messages ("abc is bidding…", "Your turn") use warm amber background (`bg-amber-900/50`) instead of blending into slate UI
- Opponent row uses `flex-wrap` to handle up to 9 opponents — was a single non-wrapping row that overflowed at 3+ players
- Trick cards in center use `flex-wrap justify-center` to handle up to 10 cards
- Round summary and Scoreboard lists are scrollable with `max-h` caps — no longer grow unbounded at 10 players
- Round winner (previous trick winner) leads bidding and first card play next round — seat-order rotation was incorrect
- `Scoreboard` simplified to name + total only; bid/tricks ratio removed (shown in player area instead)
- `TrickPanel` `round` prop removed (unused after trump label was removed)

---

## [Pre-M3 Hardening] — 2026-03-18

### Fixed
- `RoundStatus` type corrected from `'finished'` to `'complete'` — was mismatched against runtime DB writes
- `hand/route.ts`: removed dead `'scoring'` status from round filter (never written anywhere)
- `bid/route.ts`: bid amount validation strengthened to require non-negative integer (was typeof-only); fire-and-forget advance-turn DB write now returns 500 on error
- `play/route.ts`: added enum validation for `suit` and `value` inputs; all 8 fire-and-forget DB writes now checked and return 500 on failure
- `gameRules.ts`: `drawTrump` now throws on empty deck instead of crashing with `undefined.suit`
- `WaitingRoom.tsx` / `page.tsx`: extracted `ProfileJoin` named type to replace repeated inline `as unknown as` double-casts

### Added
- Unit tests for `GET /api/games/[gameId]/hand` (6 tests)
- Unit tests for `POST /api/rooms/[code]/leave` (6 tests)
- Unit tests for `getPlayerHand` in `src/lib/game/server.ts` (4 tests)
- Total unit test count: 138 (up from 122)

### Chore
- Closed stale GitHub issues #19–#36 (all M2 implementation slices complete)

---

## [M1] — Foundation — 2026-03-17

M1 goal: friends can sign in, create or join a room, and see each other in the waiting room in real time.

### Added
- Google OAuth sign-in via Supabase Auth
- Home page with Create Room and Join Room CTAs
- Create Room page and `POST /api/rooms` — validates input, generates unique 7-char room code, inserts room + host as first player
- Join Room page and `POST /api/rooms/[code]/join` — validates room state, checks capacity, inserts player
- Waiting room page (`/room/[code]`) — Server Component with auto-join logic
- Real-time player list via Supabase Postgres Changes on `room_players`
- Copy invite link button with confirmation feedback
- Leave room (`POST /api/rooms/[code]/leave`) — marks player dropped, transfers host to random remaining player, cancels room if last player leaves
- Toast banner on home page for redirect states: `room_invalid`, `room_full`, `room_in_progress`
- Admin Supabase client (service role key) for server-side RLS bypass
- Supabase TypeScript types generated from live schema — all clients fully typed
- Playwright E2E smoke tests (8 passing) covering auth redirects and sign-in page
- Vitest unit tests for room code generation, input validation, and all API routes
- PWA manifest and next-pwa setup
- Design tokens via Tailwind CSS v4 `@theme` — warm parchment palette, indigo primary, amber accent
- Fraunces (display) + DM Sans (body) fonts

### Fixed
- Dropped player re-join: revisiting an invite link after leaving now re-activates the player instead of leaving them invisible
- Removed unused `hostProfile` query from room page (dead DB call)
- `WaitingRoom` `canStart` check now uses `MIN_PLAYERS` constant instead of hardcoded `4`

### Configuration
- Supabase Realtime publication enabled for: `room_players`, `rounds`, `bids`, `trick_cards`, `tricks`, `round_scores`
- `MIN_PLAYERS` temporarily set to `2` for dev testing (revert to `4` before launch)
- Git branch-per-feature workflow established
