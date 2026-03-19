# Engineering Decisions

> This document records the tech stack, rationale, and architecture for cardsNight. It is a living document — update it when decisions change and record *why* they changed.

---

## TL;DR

| Layer | Choice |
|-------|--------|
| Frontend | Next.js 16 (App Router, TypeScript) |
| Styling | Tailwind CSS |
| Auth | Supabase Auth (Google OAuth) |
| Database | Supabase (Postgres) |
| Real-time | Supabase Realtime (Postgres Changes) |
| Game logic | Next.js API Routes (server-side validation) |
| Hosting | Vercel (frontend) + Supabase (backend/DB) |
| Testing | Vitest + React Testing Library + Playwright |
| PWA | next-pwa |

---

## Decision Rationale

### Next.js (Frontend + API layer)
**Why:** TypeScript-first, co-locates frontend and API routes in one repo, and deploys trivially to Vercel via GitHub integration. API routes give us server-side game logic validation without spinning up a separate backend service. App Router enables React Server Components for anything that doesn't need real-time (lobby, scoreboard history, etc.).

**Why not Vite + React:** No built-in API layer means a separate server, more infra to manage solo.

**Why not SvelteKit:** Good option, but TypeScript experience transfers less directly.

---

### Supabase (Auth + Database + Real-time)
**Why:** One platform handles three critical concerns — Google OAuth, Postgres, and WebSocket broadcasting — with a generous free tier. This eliminates account and integration overhead for a solo developer on a 2–3 week M1 timeline.

- **Auth:** Google Sign-In via Supabase Auth. Zero implementation cost; handles token management, session refresh, and user table creation automatically.
- **Database:** Postgres. Relational model is the right fit for game history, per-round scores, and structured room/player relationships.
- **Real-time:** Supabase Realtime Postgres Changes. Every game state mutation is a DB write; Postgres Changes delivers CDC events to all connected clients. Appropriate for a turn-based game — sub-100ms latency is not required. Broadcast channels are reserved for M3 ephemeral events (turn timer ticks, disconnection toasts).

**Free tier limits to be aware of:**
- 500 MB database storage
- 200 concurrent Realtime connections
- 50,000 monthly active users

All of these are non-issues for a prototype with a friend group. Revisit when approaching M4 (public lobby).

**Vendor risk:** Supabase is the single biggest dependency. If it becomes a problem (cost, outage, API changes), the migration path is: self-host Supabase (it's open-source) or replace Realtime with Socket.io on a VPS. The Postgres schema is portable.

---

### Game Logic in API Routes (Server-Side Validation)
**This is non-negotiable.** The client sends *intent* — "I want to play the 7 of hearts" or "I bid 3 tricks". The server:

1. Loads current game state from Postgres
2. Validates the move against game rules (correct turn? legal card? valid bid?)
3. Writes the new state to Postgres if valid, or returns an error if not
4. Supabase Realtime broadcasts the state change to all players

The client never writes game state directly. Trusting client-submitted state leads to cheating vectors and race conditions that are painful to debug later.

**Game logic must live in a pure `gameRules.ts` module** with zero framework dependencies. This makes it trivially testable in isolation. API routes call into this module — they never contain rule logic themselves. Given the complexity of Judgement (suit-following, trump cutting, last-bidder restriction, descending round structure), this module will have extensive unit test coverage before any route is wired up.

---

### Tailwind CSS
**Why:** Utility-first CSS pairs well with component-based React development. Fast to iterate on, no naming bikeshedding. Widely documented.

---

### Vitest + React Testing Library + Playwright
- **Vitest:** Faster than Jest, native ESM support, compatible with the Vite toolchain underlying Next.js.
- **React Testing Library:** Tests user-visible behavior, not implementation details. Correct default for UI components.
- **Playwright:** End-to-end tests. Crucially, Playwright supports multiple browser contexts in one test — this lets us simulate two players in the same game without running two separate test processes. Use this for game flow tests (deal cards → bid → play → score).

---

### PWA (next-pwa)
Adds ~30 minutes of setup. Provides:
- "Add to Home Screen" on mobile — better UX for the core use case (friend sends link, plays on phone)
- Offline splash screen instead of browser error on connectivity drop

Included from day one. No architectural impact.

---

## System Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Browser (Client)                  │
│  Next.js App Router  ←→  Supabase Realtime (WS)     │
│  - Game UI                - Listens for state changes│
│  - Sends move intents     - Updates local UI         │
└────────────────────┬────────────────────────────────┘
                     │ HTTPS (API Routes)
┌────────────────────▼────────────────────────────────┐
│              Next.js API Routes (Server)             │
│  - Validate moves against game rules                 │
│  - Write state transitions to Postgres               │
│  - Never trusts client-submitted state               │
└────────────────────┬────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────┐
│                    Supabase                          │
│  ┌──────────────┐  ┌──────────┐  ┌───────────────┐  │
│  │  Auth        │  │ Postgres │  │ Realtime      │  │
│  │  Google OAuth│  │ Game DB  │  │ Postgres Changes│
│  └──────────────┘  └──────────┘  └───────────────┘  │
└─────────────────────────────────────────────────────┘
```

---

## Data Model (Implemented Schema)

- `profiles` — extends Supabase Auth users; `id` (FK to `auth.users`), `display_name`, `avatar_url`. Populated by `handle_new_user` trigger on `auth.users INSERT`.
- `rooms` — `code` (7-char unique), `host_id`, `game_type`, `max_players`, `turn_timer_seconds`, `status` (`waiting` | `in_progress` | `finished` | `cancelled`), `expires_at`
- `room_players` — join table: `room_id` + `user_id`, `seat_order` (assigned at game start), `status` (`active` | `disconnected` | `dropped`)
- `games` — one per game, `room_id`, `status` (`in_progress` | `finished`)
- `rounds` — one per round, `game_id`, `round_number`, `hand_size`, `trump_suit`, `trump_card_value`, `status` (`bidding` | `playing` | `complete`), `current_player_id`
- `hands` — immutable dealt hand per player per round: `round_id`, `player_id`, `cards` (JSONB array of `{suit, value}`)
- `bids` — one per player per round: `round_id`, `player_id`, `amount`
- `tricks` — one per trick: `round_id`, `trick_number`, `led_suit`, `winner_id`
- `trick_cards` — one card per player per trick: `trick_id`, `player_id`, `suit`, `value`
- `round_scores` — scored after each round: `round_id`, `player_id`, `bid`, `tricks_won`, `score`
- `game_results` — final result per player: `game_id`, `player_id`, `placement`, `result` (`win` | `loss`), `total_score`

**Realtime publication** is enabled on: `room_players`, `rounds`, `bids`, `trick_cards`, `tricks`, `round_scores`. `bids` and `tricks` have `REPLICA IDENTITY FULL` so UPDATE payloads include all columns.

---

## Development Workflow

### Branch strategy
- `main` — always deployable; Vercel auto-deploys on push
- Feature branches off `main`; merge via PR (even solo — keeps history clean)

### Local development
```bash
# After stack is initialized (see Setup section in CLAUDE.md):
npm run dev          # Next.js dev server with hot reload
npm run test         # Vitest unit/component tests
npm run test:e2e     # Playwright end-to-end tests
```

### Environment variables
Never commit `.env.local`. Required variables:
```
NEXT_PUBLIC_SUPABASE_URL=       # Supabase project URL (safe to expose)
NEXT_PUBLIC_SUPABASE_ANON_KEY=  # Supabase anon key (safe to expose)
SUPABASE_SERVICE_ROLE_KEY=      # Service role key — server-side only, never expose to client
```

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Supabase Realtime drops connections mid-game | Low | High | Implement reconnection logic with 60s window (per PRD); resync state from Postgres on reconnect |
| Race conditions on simultaneous moves | Medium | High | All writes go through server API routes; use Postgres row-level locking for turn validation |
| Supabase free tier limits hit | Low (prototype) | Medium | Monitor usage; upgrade is $25/mo or self-host |
| Game logic bugs in API routes | High (inevitable) | Medium | Server-side logic must have unit test coverage; game rules are complex and easy to mis-implement |
| Cold starts on Vercel serverless functions | Low | Low | API routes are fast to initialize; not a concern at this traffic level |

---

## Accounts to Create

In order of when they're needed:

1. **Supabase** — needed before any M1 code is written. Free tier.
2. **Vercel** — connect GitHub repo; needed before first deployment. Free tier.

That's it for M1–M3.

---

## Disconnection Handling (M3)

**Decision:** round continues, dropped player's turns are auto-resolved.

**Rationale:** Discarding or re-dealing a round punishes all remaining players for one dropout. Auto-resolving is less disruptive and simpler to implement.

**Auto-resolution rules:**
- **Bid:** Assign the lowest *biddable* number — not necessarily 0, since the last-bidder restriction may forbid it. The same `getValidBids()` function used for human players determines the legal range; pick the minimum.
- **Card play:** Play the lowest legal card from the player's hand (must follow suit if possible; otherwise lowest card by value).

**Reconnection flow:**
1. Client detects WebSocket drop via Supabase channel status events
2. Server detects absence via Supabase Presence (heartbeat timeout); sets `room_players.status = 'disconnected'` and stamps `disconnected_at`
3. All clients see a 60-second countdown UI
4. If player reconnects within 60s: re-subscribes to channel, re-fetches full game state from a single `/api/game/state` endpoint, resumes normally
5. If 60s elapses: server sets status to `dropped`, auto-resolution takes over for their remaining turns that round; they are removed from subsequent rounds; result recorded as a loss

**Schema implications (must be in place from M1):**
- `room_players.status` — `active | disconnected | dropped`
- `room_players.disconnected_at` — timestamp, nullable
- The 60-second timer is server-enforced (based on `disconnected_at`), not client-enforced, to prevent manipulation

---

## M2 Architecture Patterns (established during Judgement implementation)

### Admin client for all game API routes
All API routes added in M2 (`bid`, `play`, `hand`, `start`) use `createAdminClient()` (service role key) for database queries after verifying auth via `supabase.auth.getUser()`. This bypasses RLS for game logic queries.

**Why:** The `room_players` SELECT RLS policy is self-referential — it checks membership by querying `room_players` itself. A user who is not yet a member (e.g. joining a room) fails the policy evaluation, causing a Postgres error rather than returning zero rows. Using the admin client for game route DB queries avoids this class of issue entirely. Auth is still enforced at the application layer (check `user.id` against player lists explicitly).

**Rule:** Auth check = SSR client (`supabase.auth.getUser()`). All DB queries in API routes = admin client.

---

### Stable Realtime channel pattern (refs over state in deps)
`GameShell` subscribes to all game tables in a single `useEffect` with `[gameId]` as the only dependency. Game state (`round`, `currentTrick`) is accessed inside event handlers via `useRef`, not read from the closure.

**Why:** If `round` or `currentTrick` were in `useEffect` deps, the channel would tear down and re-subscribe on every state change. This creates a window where events are missed. Using refs gives event handlers access to the latest state without triggering re-subscription.

**Pattern:**
```ts
const roundRef = useRef(initialRound)
useEffect(() => { roundRef.current = round }, [round])
// useEffect([gameId]) — channel never recreates during gameplay
```

---

### Realtime unreliability — active fallback fetch after trick resolution
Supabase Realtime occasionally drops `INSERT` events (observed: `tricks INSERT` being swallowed after a trick resolves). If this happens, the next trick never appears and the game stalls.

**Mitigation:** After every `tricks UPDATE` where `winner_id` is set (trick resolved), GameShell starts a `setTimeout` that fires after the animation completes (~1400ms total). Inside that timeout, it performs an active Supabase client query for the next incomplete trick (`winner_id IS NULL`). If the INSERT event was dropped, this fetch recovers the state; if the event arrived normally, the query returns the same data idempotently.

```ts
setTimeout(async () => {
  const { data: nextTrick } = await sb.from('tricks')
    .select('id, trick_number, led_suit, winner_id')
    .eq('round_id', roundId).is('winner_id', null).maybeSingle()
  if (nextTrick) setCurrentTrick(nextTrick as Trick)
}, 700) // after CSS animation
```

**Principle:** Realtime is "best-effort delivery with optimistic UI"; active DB queries are the fallback for correctness. Do not rely on Realtime as the sole mechanism for critical state transitions.

---

### useState sync via useEffect keyed on round ID
`router.refresh()` causes the Server Component to re-render and pass new props, but **`useState` initial values are only used on first mount** — they do not update when props change. Without explicit sync, `round`, `hand`, `bids`, etc. stay stale after a round transition.

**Fix:** A dedicated `useEffect` keyed on `initialRound?.id` resets all per-round client state whenever the server provides a new round:

```ts
// eslint-disable-next-line react-hooks/exhaustive-deps
useEffect(() => {
  setRound(initialRound); setBids(initialBids); setHand(initialHand)
  setCurrentTrick(initialCurrentTrick); setTrickCards(initialTrickCards)
  setTricksWon(initialTricksWon); setTrickAnimation(null)
  roundRef.current = initialRound; currentTrickRef.current = initialCurrentTrick
}, [initialRound?.id])
```

**Important:** `showRoundSummary` is intentionally excluded from this reset — see Snapshot state pattern below.

---

### Snapshot state pattern for the round summary overlay
The end-of-round summary must show bids and tricks-won from the *just-completed* round, but `router.refresh()` (triggered by `rounds INSERT` for the new round) arrives within milliseconds of round completion and would overwrite `bids` and `tricksWon` in client state.

**Fix:** When `rounds UPDATE` fires with `status === 'complete'`, take an immediate snapshot into separate frozen state vars before the new round's data arrives:

```ts
setSummaryTricksWon({ ...tricksWonRef.current })  // ref = always current
setSummaryBids([...bidsRef.current])
setSummaryRoundScores({})  // populated incrementally by round_scores INSERTs
setShowRoundSummary(true)
```

The overlay reads from `summaryTricksWon` / `summaryBids` / `summaryRoundScores`, not from live game state. The `useEffect` sync resets live state freely without affecting the overlay. User dismisses with an explicit tap; only then does the overlay clear.

**When to apply this pattern:** Any overlay/modal that must display state from a specific moment in time while the underlying game state continues evolving.

---

### Test-only auth endpoint (`/api/test/auth`)
Playwright E2E tests need authenticated `page.request` contexts. The SSR client sets session cookies, making all subsequent API calls from that page context authenticated.

`POST /api/test/auth` accepts `{ email, password }`, calls `supabase.auth.signInWithPassword`, and returns `{ userId }`. It returns 404 in production (`NODE_ENV === 'production'`).

**Why not Google OAuth in tests:** OAuth requires a real browser interaction. Email/password auth is testable headlessly. Test users are created via the Supabase Auth admin API.

---

## Decisions Deferred

- **Hosting cost optimization** — revisit at M4 when public traffic begins
- **CDN / asset caching** — Vercel handles this automatically for now
- **Database connection pooling** — Supabase handles this; revisit if query latency becomes an issue
- **Second game architecture** — M5 concern; document how game modules will be structured when we get there
- **`MIN_PLAYERS` constant** — currently set to `2` for dev/test; revert to `4` before M3 launch
