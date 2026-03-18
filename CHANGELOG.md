# Changelog

All notable changes to cardsNight are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

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
