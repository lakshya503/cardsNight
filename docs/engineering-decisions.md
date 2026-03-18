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

## Data Model (Initial Schema)

To be finalized before M1 implementation, but the core entities are:

- `users` — managed by Supabase Auth, extended with display name and avatar
- `rooms` — room code, host user, player count limits, turn timer setting, status (waiting/in-progress/finished)
- `room_players` — join table: room ↔ user, seat order, status (`active` | `disconnected` | `dropped`), `disconnected_at` timestamp
- `games` — one per completed/active game, linked to a room
- `rounds` — one per round, stores trump card/suit, hand size, round number
- `bids` — one per player per round
- `tricks` — one per trick played, stores cards played and winner
- `game_results` — final scores per player per game

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


   # server-side only, never expose to client
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

## Decisions Deferred

- **Hosting cost optimization** — revisit at M4 when public traffic begins
- **CDN / asset caching** — Vercel handles this automatically for now
- **Database connection pooling** — Supabase handles this; revisit if query latency becomes an issue
- **Second game architecture** — M5 concern; document how game modules will be structured when we get there
