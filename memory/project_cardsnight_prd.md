---
name: cardsNight PRD context
description: Core product goals, MVP scope, game rules, and milestones for the cardsNight card game platform
type: project
---

cardsNight is a web-based multiplayer card game platform. Full PRD is at `docs/CardGames_Product_PRD.docx`.

**Why:** Build the simplest, most enjoyable browser-based platform for playing card games with friends — no downloads, no friction, no gambling associations.

**North Star:** A friend sends a link → click → Google sign-in → playing cards within 60 seconds.

## MVP scope
- Sole game: **Judgement** (trick-taking, 4–10 players)
- Private invite-only rooms only (no public lobby until M4)
- Google Sign-In (no passwords)
- Real-time multiplayer (all state updates instant)
- Player profiles with game history

## Judgement rules (authoritative)
- Pyramid round structure (hand size down to 1, back up to starting count)
- Trump set by flipping top of undealt deck each round; always visible
- Bidding: last bidder cannot make total bids = cards dealt (restriction rule)
- Must follow suit; can cut (trump) or fuse (off-suit) if void
- Scoring: exact bid = 10×bid (0 bid = 10 pts); wrong = 0 pts
- Starting hand size: 4-6p→8, 7p→7, 8p→6, 9-10p→5

## Milestones
1. M1 – Auth, rooms, waiting room
2. M2 – Judgement fully playable
3. M3 – Polish, disconnections, mobile
4. M4 – Public lobby, leaderboard
5. M5 – Second card game

## Hard out-of-scope (never build)
- Gambling / real money
- In-game chat or voice
- Native iOS/Android apps
- AI opponents (v1)
- Spectator mode
- Monetisation

**How to apply:** Always reference this when making product, design, or architecture decisions. Keep scope lean per milestones — don't add features beyond the current milestone's done condition.
