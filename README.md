# cardsNight

A web-based multiplayer card game platform. Send a friend a link, sign in with Google, and you're playing cards in under 60 seconds.

## What it is

cardsNight hosts invite-only card game rooms. The host creates a room, shares the code or link, and friends join — no accounts beyond Google Sign-In required. The MVP ships with **Judgement**, a trick-taking game for 2–8 players.

## Game: Judgement

Trick-taking card game with descending rounds (starting hand size down to 1 card).

- **Trump** is revealed each round by flipping the top undealt card
- **Bidding** — players predict how many tricks they'll win; the last bidder can't make total bids equal cards dealt
- **Scoring** — exact bid = 10 + (10 × bid), any other outcome = 0
- **Win** — highest cumulative score after all rounds

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router, TypeScript) |
| Auth + DB + Realtime | Supabase (Google OAuth, Postgres, Postgres Changes) |
| Styling | Tailwind CSS v4 with `@theme` design tokens |
| Animations | Framer Motion |
| Tests | Vitest + React Testing Library, Playwright (E2E) |

## Running locally

```bash
# Install dependencies
npm install

# Copy the example env file and fill in your Supabase project details
cp .env.example .env.local

# Start dev server
npm run dev

# Unit tests
npm test

# E2E tests (dev server must be running)
npm run test:e2e
```

## Roadmap

| Milestone | Goal |
|---|---|
| M1 ✅ | Auth, rooms, waiting room |
| M2 ✅ | Judgement fully playable end-to-end |
| M3 | Polish, disconnection handling, mobile |
| M4 | Public rooms, lobby, leaderboard |
| M5 | Second card game |
