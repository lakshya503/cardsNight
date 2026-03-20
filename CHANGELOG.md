# Changelog

All notable changes to cardsNight are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [M2] — Judgement Fully Playable — 2026-03-18

M2 goal: 4+ friends play a complete game of Judgement with correct rules, scoring, and history saved.

### Added
- `POST /api/rooms/[code]/start` — starts game, assigns seats, deals hands, flips trump, creates first round and trick
- `POST /api/games/[gameId]/bid` — validates turn order and restriction rule; transitions round to playing after last bid
- `GET /api/games/[gameId]/hand` — returns authenticated player's current hand (dealt cards minus played)
- `POST /api/games/[gameId]/play` — validates card play (suit-follow rule), updates trick state, resolves trick winner; after last trick: scores round, starts next round or ends game
- Full round lifecycle: `bidding → playing → complete`; game lifecycle: `in_progress → finished`
- `scoreRound` and `determinePlacements` game logic (exact bid = 10×bid, 0-bid exact = 10 pts, miss = 0; dense ranking)
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
