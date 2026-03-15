# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

**cardsNight** is a web-based multiplayer card game platform. The MVP delivers a single game — **Judgement** — playable via private invite-only rooms. Players authenticate with Google Sign-In, create or join rooms, and play in real time. The full PRD is at `docs/CardGames_Product_PRD.docx` and is the authoritative reference for all product and design decisions.

## Product Vision

> A friend sends you a link. You click it, sign in with Google, and you are playing cards within 60 seconds.

- **Target users (MVP):** Friend groups using private invite rooms
- **Target users (v2+):** Casual players via public lobby and leaderboard
- **Never in scope:** gambling, real-money, chat/voice, native apps, AI opponents (v1), spectator mode

## MVP Game: Judgement

Trick-taking card game, 4–10 players, one standard 52-card deck.

- **Rounds:** Pyramid structure — hand size decreases from starting count down to 1, then back up
- **Trump:** Determined each round by flipping the top card of the undealt deck; always visible to all players
- **Bidding:** Players bid tricks in turn order; last bidder cannot bid the number that makes total bids equal cards dealt (restriction rule)
- **Card play:** Must follow suit if possible; can cut (trump) or fuse (off-suit) if void in led suit
- **Scoring:** Exact bid = 10 × bid (bid of 0 = 10 pts); any other outcome = 0 pts for that round
- **Win condition:** Highest cumulative score after all rounds; ties are shared wins
- **Player counts and starting hand sizes:**
  - 4–6 players → 8 cards
  - 7 players → 7 cards
  - 8 players → 6 cards
  - 9–10 players → 5 cards

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

## Architecture Needs

The tech stack has not been chosen yet. Key requirements to drive those decisions:

- **Real-time multiplayer** — all players see game state instantly (WebSockets or equivalent, e.g. Socket.io, Supabase Realtime, Partykit)
- **Authentication** — Google Sign-In (OAuth 2.0)
- **Private rooms** — unique invite link + room code generation
- **Persistence** — player profiles, game history, per-round scores
- **Responsive** — must work on both mobile and desktop browsers

## Development Setup

No build system set up yet. Update this section once a stack is chosen with:
- Install dependencies
- Run dev server
- Run tests (including how to run a single test)
- Build for production
