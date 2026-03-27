# CLAUDE.md — cardsNight

Project-specific instructions for the cardsNight codebase. Global behavior, git workflow, communication style, and session management rules are in `~/.claude/CLAUDE.md`.

## Documentation

- **Keep `CLAUDE.md` up to date** — if a decision is made, a pattern is established, or the stack changes, update this file in the same commit
- **Keep `CHANGELOG.md` up to date** — after merging a feature branch to `main`, add an entry under the appropriate version/milestone section following Keep a Changelog format (`Added`, `Changed`, `Fixed`, `Removed`)
- **Keep `docs/engineering-decisions.md` up to date** — if an architectural decision is made or revised during development, record it there immediately

## Code Standards

- **No TODO/FIXME/HACK comments in code** — if something needs doing later, open a GitHub issue immediately and reference the issue number in the commit message or PR. Comments that explain *why* are fine; deferred work belongs in the tracker, not the source.
- Write tests for all new logic; flag when existing code lacks test coverage
- Point out when something should be abstracted vs. kept inline
- Call out unclear or misleading naming before it becomes convention
- Follow consistent patterns — if a pattern exists in the codebase, use it; if it's wrong, flag it before extending it
- Keep modules and functions focused; push back on functions that do too many things

## Overview

**cardsNight** is a web-based multiplayer card game platform. The MVP delivers a single game — **Judgement** — playable via private invite-only rooms. Players authenticate with Google Sign-In, create or join rooms, and play in real time.

## Reference Documents

Always consult these documents before making product or engineering decisions:

| Document | Path | Contains |
|----------|------|----------|
| Product PRD | `docs/CardGames_Product_PRD.md` | Authoritative source for product requirements, game rules, UX rules, milestones, and scope |
| Engineering Decisions | `docs/engineering-decisions.md` | Tech stack, architecture, rationale, data model, disconnection handling, and deferred decisions |
| M2 Design Spec | `docs/superpowers/specs/2026-03-17-m2-judgement-game-design.md` | Authoritative M2 architecture: state machine, API surface, game rules module, UI structure, testing slices |

**Conflict resolution:** PRD takes precedence on product behavior; engineering decisions doc takes precedence on implementation approach; design spec takes precedence on M2 implementation details.

## Product Vision

> A friend sends you a link. You click it, sign in with Google or enter a display name as a guest, and you are playing cards within 60 seconds.

- **Target users (MVP):** Friend groups using private invite rooms
- **Target users (v2+):** Casual players via public lobby and leaderboard
- **Never in scope:** gambling, real-money, chat/voice, native apps, AI opponents (v1), spectator mode

## MVP Game: Judgement

Trick-taking card game, 4–10 players, one standard 52-card deck.

- **Rounds:** Descending only — hand size decreases from the starting count down to 1 (no climb back up)
- **Trump:** Determined each round by flipping the top card of the undealt deck; always visible to all players
- **Bidding:** Players bid tricks in turn order; last bidder cannot bid the number that makes total bids equal cards dealt (restriction rule)
- **Card play:** Must follow suit if possible; can cut (trump) or fuse (off-suit) if void in led suit
- **Scoring:** Exact bid = 10 + (10 × bid) — bid 0 = 10 pts, bid 1 = 20 pts, bid 3 = 40 pts; any other outcome = 0 pts for that round
- **Win condition:** Highest cumulative score after all rounds; ties are shared wins
- **Player counts and starting hand sizes:**
  - 2–6 players → 8 cards
  - 7 players → 7 cards
  - 8 players → 6 cards

## Key UX Rules

- Trump card and suit stay visible to all players for the entire round
- Invalid card plays are rejected with an explanation (card returns to hand)
- Invalid bids for the last bidder show which number is forbidden and why
- Each player sees only their own hand; other players' hands are private
- Running scoreboard (cumulative scores), current bid, and tricks won per round visible to all at all times
- "How to Play" button always accessible from the game screen
- Turn timer set by host at room creation; auto-resolves turn on expiry

## Disconnection Handling

- **Pre-game (host drops):** Host status transfers to a random player already in the room
- **Mid-game:** 60-second reconnection window shown to all; if player doesn't reconnect, current round is voided and game continues without them; dropped player's score retained on scoreboard; recorded as a loss
- **Intentional leave:** Recorded as a loss; game continues for remaining players

## Milestones

| # | Goal | Done When |
|---|------|-----------|
| M1 | Foundation — auth, rooms, waiting room | Friends can sign in, create/join a room, see each other in waiting room |
| M2 | Judgement fully playable end-to-end | 4+ friends play a complete game with correct rules, scoring, and history saved |
| M3 | Polish & disconnection handling | Drop-outs handled gracefully; works cleanly on mobile and desktop |
| M4 | Public rooms, lobby, leaderboard | Stranger can join a public game without an invite and see the leaderboard |
| M5 | Second card game added | Two games playable; adding a third requires no changes to shared platform code |

## Tech Stack

- **Framework:** Next.js 16 (App Router, TypeScript)
- **Auth + DB + Realtime:** Supabase (Google OAuth, anonymous guest auth, Postgres, Postgres Changes)
- **Styling:** Tailwind CSS v4 with `@theme` design tokens
- **Animations:** Framer Motion
- **Fonts:** Fraunces (display) + DM Sans (body) via next/font/google
- **PWA:** @ducanh2912/next-pwa
- **Unit tests:** Vitest + React Testing Library
- **E2E tests:** Playwright

## Development Setup

```bash
npm install
cp .env.example .env.local   # fill in Supabase keys + ANTHROPIC_API_KEY (required for local review hooks)
npm run dev

npm test                              # unit tests (Node 20.19+)
npm test -- --reporter=verbose
npm run test:e2e                      # E2E (dev server must be running)
npx tsc --noEmit                      # type check
npm run build
```

## Local Review Pipeline

Every commit on a feature branch triggers two automatic hooks:

1. **Pre-commit:** `npm test` runs and blocks the commit on failure
2. **Post-commit (async):** `.claude/scripts/run-reviews.js` calls correctness and scalability reviewers in parallel (both Haiku) via the Anthropic API. Results are written to `.commit-reviews/<SHA>-correctness.md` and `.commit-reviews/<SHA>-scalability.md`. The Claude Code session is woken if HIGH or MEDIUM issues are found.

A pre-push gate (`.claude/scripts/check-review-gate.js`) intercepts `git push`, `git merge`, and `gh pr merge` — all three are blocked until both stamp files exist for HEAD. **Never attempt a push or merge before the async reviews complete.**

- **HIGH or MEDIUM** findings must be fixed and re-committed before merging
- **LOW** findings are informational only
- `ANTHROPIC_API_KEY` must be set in `.env.local` — without it, reviews are skipped and the gate will block all pushes

A `SessionStart` hook warns at session open if any open PR has failing CI checks.

## Supabase Type Generation

After any schema change:
```bash
npx supabase gen types typescript --project-id <your-project-id> > src/lib/supabase/database.types.ts
```
