# cardsNight Product Requirements Document

---

## 1. Purpose & Vision

This document defines the product requirements for a web-based multiplayer card game platform. It covers the why, the what, and the how at a product level.

### 1.1 Problem Statement

Playing card games with friends online is unnecessarily complicated. Existing platforms are cluttered, require downloads, ask you to create accounts with passwords, or feel dated. There is no simple, modern, frictionless option for casual friend groups who just want to play.

### 1.2 Product Vision

Build the simplest, most enjoyable web platform for playing card games with friends — fast to join, easy to understand, and fun to use on any device.

> A friend sends you a link. You click it, sign in with Google, and you are playing cards within 60 seconds.

---

## 2. Target Users

The platform serves two overlapping audiences: people who want to organise a game with specific friends, and casual players who want to drop into a game with strangers.

### 2.1 Out of Scope Users

- Competitive or ranked players — no rating or ELO system planned
- Gamblers — no real-money or wagering mechanics, ever
- Children under 13 — no parental controls or COPPA compliance in scope

---

## 3. Goals & Non-Goals

### 3.1 Goals

- Ship a polished, working MVP of Judgement playable via private rooms
- Let a host create a private room and share an invite link with friends
- Authenticate players quickly via Google Sign-In — no passwords to manage
- Deliver a seamless real-time experience — all players see the game state instantly
- Work equally well on desktop and mobile browsers
- Give players a personal game history so they can track their record over time
- Build the platform so adding future card games requires minimal rework

### 3.2 Non-Goals for MVP

- No public game lobby — all games are private invite-only in v1
- No leaderboards — planned for v2 alongside public rooms
- No in-game chat, reactions, or voice communication
- No virtual currency, rewards, or any form of monetisation
- No AI or bot opponents (noted as a future enhancement for dropped-player replacement only)
- No spectator mode
- No native iOS or Android app

---

## 4. User Experience & Interactions

This section describes what users see and do at each stage — from first visit to completing a game. This is the full intended user journey.

### 4.1 Sign-In & Onboarding

New and returning users land on a welcome screen that clearly communicates what the platform is. Sign-in is a single action.

- Unauthenticated visitors see a landing page with a prominent sign-in prompt
- Signing in with Google creates an account automatically on first visit
- After sign-in, users land directly on the home screen
- Returning users with an active session skip the sign-in step entirely

### 4.2 Home Screen

After sign-in, the player lands on a simple home screen. In v1 there is no public lobby — the only actions available are creating a room or joining one via code.

- A clear call-to-action to create a new private room
- A field to enter an invite code to join an existing room
- Navigation to their own profile and game history
- No public room listings in v1

### 4.3 Creating a Room

The host sets up a game room before inviting others to join.

- Host selects the game to play (Judgement in v1)
- Host configures game parameters — including the turn timer duration
- A unique invite link and room code are generated immediately upon room creation
- Host can share the link or code directly with friends
- Host is taken to the waiting room once the room is created

### 4.4 Pre-Game Waiting Room

Players gather here after joining via the invite link or code, before the game begins.

- Displays a live list of players who have joined
- Shows the minimum and maximum player count for the selected game
- The invite link and room code remain visible and copyable on this screen
- The host sees a Start Game button, which becomes active once the minimum player count is met
- Non-host players see a clear waiting state

#### Host disconnection before game starts

- If the host disconnects while players are waiting, host status is transferred to a randomly selected player already in the room
- The new host is notified and immediately takes over host controls
- All other players in the room are informed that the host has changed

### 4.5 In-Game Experience

The game screen is the core of the product. All players see the game state update in real time without any page refresh.

#### Game screen principles

- Each player sees their own hand clearly, separate from other players
- Only information a player is entitled to see is shown — other players' hands are private
- Whose turn it is must be clearly and persistently communicated at all times
- Valid moves are visually distinct from invalid ones
- All game state updates appear instantly for every player when a move is made
- A "How to Play" button is always accessible on the game screen, opening a dedicated rules page

#### Trump display

- The trump card for the current round is always visibly displayed on screen throughout the entire round
- The trump suit derived from that card is clearly labelled so there is no ambiguity

#### Turn timer

- The turn timer duration is set by the host at room creation
- A visible countdown is displayed during each player's turn
- If the timer expires, the turn is auto-resolved according to the game rules

#### Player disconnection mid-game

- If a player loses connection, a 60-second reconnection window is displayed to all players
- If the player reconnects within 60 seconds, the game continues normally from where it left off
- If the player does not reconnect within 60 seconds, they are dropped from the game
- When a player is dropped: the current round is voided and a new round begins without them
- The dropped player's cumulative score up to that point remains visible on the scoreboard
- The dropped player's result is recorded as a loss in their game history

#### Leaving a game intentionally

- A player may leave a game at any time
- Leaving early is recorded as a loss in the player's game history
- The game continues for remaining players using the same dropped-player resolution rules

### 4.6 End of Game

When a game reaches its natural conclusion, players are shown a clear results screen.

- Results screen shows the final scoreboard: all players, their bids per round, tricks won per round, and total score
- The winner is prominently highlighted
- The result is saved automatically to each player's game history
- Players are offered the option to play again with the same group, or return to the home screen

### 4.7 Player Profile & History

Each player has a personal profile accessible from the home screen at any time.

- Displays: display name, Google profile photo, and member-since date
- Game history log: game type, result (win / loss), date played, and who they played against
- Summary stats: total games played, win rate, and most-played game
- Profile and history are private — visible only to the account owner

---

## 5. Game Specification — Judgement

Judgement is the first game on the platform and the sole game for the MVP. This section defines the complete rules, interactions, and UI behaviour required.

### 5.1 Overview

Judgement is a trick-taking card game where players bid on how many tricks they will win in each round. The goal is to win exactly as many tricks as you bid — no more, no less.

### 5.2 Players & Setup

- Minimum players: 2. Maximum players: 8
- One standard 52-card deck is used
- Starting hand size is determined by player count as follows:
  - 2 or 3 players: start with 10 cards
  - 4, 5, or 6 players: start with 8 cards
  - 7 players: start with 7 cards
  - 8 players: start with 6 cards

### 5.3 Round Structure

A full game consists of multiple rounds. Cards dealt decrease by 1 each round until the 1-card round, which is the final round.

- Cards dealt decrease by 1 each round until reaching 1
- The 1-card round is the last round — the game ends after it completes
- Example for 2–3 players (starting at 10 cards): rounds go 10, 9, 8, 7, 6, 5, 4, 3, 2, 1
- Example for 4–6 players (starting at 8 cards): rounds go 8, 7, 6, 5, 4, 3, 2, 1
- Example for 7 players (starting at 7 cards): rounds go 7, 6, 5, 4, 3, 2, 1

#### Determining trump each round

- After cards are dealt for a round, the top card of the remaining undealt deck is flipped face-up and displayed to all players
- The suit of that flipped card is the trump suit for that round
- The flipped trump card remains visible to all players for the entire duration of that round
- Bidding does not begin until the trump card has been revealed
- Every round has a trump suit — there are no no-trump rounds
- Because the trump is determined by a random card flip, the trump suit is not predictable in advance

#### Who starts each round

Players take turns leading each round. The starting player rotates by one position each round. The same player who leads bidding leads the first trick of that round.

### 5.4 Bidding

After the trump card is revealed, each player bids the number of tricks they expect to win in that round.

- Players bid in turn order, starting from the player leading that round
- Bidding only begins after the trump card is shown to all players
- A bid of 0 is valid — the player aims to win no tricks at all

#### The restriction rule

The last player to bid in each round is subject to a restriction: their bid cannot be a number that would make the total of all bids equal to the number of cards dealt in that round.

- Example: 8 cards are dealt, 4 players. Player 1 bids 2, Player 2 bids 3, Player 3 bids 1. The total so far is 6. Player 4 cannot bid 2, because 6 + 2 = 8 (the number of cards dealt). All other bids are valid.
- The UI must clearly show the last bidder which number is forbidden and why
- An "Invalid bid" message is shown if the last player attempts a forbidden bid

### 5.5 Card Play & Precedence

After bidding, players play one card per trick in turn order. The winner of each trick leads the next one.

#### Playing rules

- A player may lead any card they choose, including a trump card
- If a player holds a card matching the suit that was led, they must play that suit — following suit is mandatory
- If a player does not hold the led suit, they may either cut (play a trump card to win the trick) or fuse (play any other card)
- If a player attempts to play an off-suit card while holding the led suit, the card is returned to their hand — the move is invalid

#### Winning a trick

- The trump suit beats all non-trump cards
- If multiple trump cards are played in the same trick, the highest-ranking trump wins
- If no trump card is played, the highest card of the led suit wins the trick
- Card rank from highest to lowest: Ace, King, Queen, Jack, 10, 9, 8, 7, 6, 5, 4, 3, 2

### 5.6 Scoring

Scoring is calculated at the end of each round once all tricks have been played.

- If a player wins exactly the number of tricks they bid: they score 10 × their bid
- Exception: a successful bid of 0 (winning zero tricks) scores 10 points
- If a player wins more or fewer tricks than they bid: they score 0 points for that round
- There are no negative scores

### 5.7 Winning the Game

The game ends after the 1-card round completes. The player with the highest cumulative score wins. If two or more players are tied on the highest score, all tied players share the win.

### 5.8 UI Behaviour & Validation

The following specific UI behaviours must be implemented to ensure players understand and play correctly.

- **Trump card display:** the flipped trump card and its suit are shown prominently and remain visible to all players throughout the entire round
- **Invalid card plays:** if a player tries to play an off-suit card while holding the led suit, the card visually returns to their hand and an explanation is shown
- **Invalid bids:** if the last bidder enters the forbidden number, an inline message explains which number is not allowed and why
- The current round number, trump suit, trump card, and number of cards dealt are always visible on the game screen
- Each player's current bid and tricks won so far in the round are visible to all players at all times
- The running scoreboard showing all players' cumulative scores is always visible
- A "How to Play" button is always visible on the game screen and opens a dedicated Judgement rules page

---

## 6. Milestones

The project is broken into five sequential milestones. Each has a clear goal and a defined done condition. Scope is kept strictly to what is needed for each milestone.

### Milestone 1 — Foundation

- Google Sign-In — account created automatically on first login, sessions persist
- Home screen accessible to authenticated users only
- Create a room — select game type and configure host parameters including turn timer duration
- Private rooms generate a unique invite link and room code
- Join a room via invite link or by entering a room code
- Pre-game waiting room with a live player list
- Host sees Start Game button (disabled until minimum players have joined)
- Host disconnection handling — host status transfers to a randomly selected player in the room
- Basic player profile page: name, photo, member-since date

### Milestone 2 — Judgement Playable

- Full implementation of Judgement per the rules in Section 5
- Trump card revealed at the start of each round — top of undealt deck flipped and shown to all players
- Trump card and suit remain visible throughout each round
- Bidding phase enforces the restriction rule for the last bidder
- Real-time card play — all players see every move instantly
- Card validation — invalid plays are rejected with a clear explanation
- Trump suit logic — cutting and fusing behave correctly
- Trick resolution and hand tracking per round
- Scoring calculated and displayed at end of each round
- End-of-game results screen with full scoreboard and winner highlighted
- Game result saved automatically to each player's history
- Play again or return to home screen option on the results screen
- "How to Play" button linking to the Judgement rules page

### Milestone 3 — Polish & Disconnection Handling

- Turn timer with visible countdown and auto-resolution on expiry
- Player disconnection handling — 60-second reconnection window displayed to all players
- Dropped player resolution — current round voided, game continues without the dropped player
- Dropped player cumulative score retained on scoreboard up to point of exit
- Early exit recorded as a loss in game history
- Fully responsive design — tested and polished on both mobile and desktop
- Complete game history and summary stats displayed on player profile
- General UX polish: loading states, empty states, error messages, edge case copy throughout

### Milestone 4 — Public Rooms, Lobby & Leaderboard

- Public game lobby visible to all authenticated users
- Public rooms are auto-named by game type and listed in the lobby
- Any authenticated user can join an open public room from the lobby
- Rooms already in progress are shown as locked and not joinable
- Home screen updated to surface both create room and browse public games
- Leaderboard showing top players by win rate or total wins, visible to all users

### Milestone 5 — Additional Games

- Game selection available when creating a room
- Second card game fully implemented (rules to be provided via a separate Game Rules document)
- Game-specific player count requirements and rules enforced
- Profile stats broken out by game type
- Leaderboard filterable by game type
- Confirmed: adding a third game requires no changes to shared platform code

---

## 7. Success Metrics

These indicators will be used to evaluate whether the product is delivering value. Specific targets will be set once the platform has real users.

---

## 8. Confirmed Out of Scope

The following will not be built or influence any product decisions unless this document is explicitly updated and versioned.

- Real-money gambling or wagering of any kind
- In-game chat, voice communication, or social reactions
- Native iOS or Android applications
- AI or bot opponents in v1 (noted as a future consideration for dropped-player replacement only)
- Spectator mode
- Friends lists, social graphs, or follower mechanics
- Monetisation of any kind
