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
