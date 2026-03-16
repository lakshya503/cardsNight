-- =============================================================
-- cardsNight: Row Level Security Policies
-- =============================================================
-- Convention:
--   authenticated users = signed-in players
--   service_role key (server-side only) bypasses RLS entirely

-- ---------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------
-- Anyone signed in can read any profile (needed for scoreboard, waiting room)
create policy "profiles: authenticated users can read all"
  on public.profiles for select
  to authenticated
  using (true);

-- Users can only update their own profile
create policy "profiles: users can update own"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id);

-- ---------------------------------------------------------------
-- rooms
-- ---------------------------------------------------------------
-- Any signed-in user can read a room (needed to join via code)
create policy "rooms: authenticated users can read"
  on public.rooms for select
  to authenticated
  using (true);

-- Only authenticated users can create rooms
create policy "rooms: authenticated users can create"
  on public.rooms for insert
  to authenticated
  with check (auth.uid() = host_id);

-- Only the host can update room settings
create policy "rooms: host can update"
  on public.rooms for update
  to authenticated
  using (auth.uid() = host_id);

-- ---------------------------------------------------------------
-- room_players
-- ---------------------------------------------------------------
-- Players in the room can see who else is in the room
create policy "room_players: room members can read"
  on public.room_players for select
  to authenticated
  using (
    exists (
      select 1 from public.room_players rp
      where rp.room_id = room_players.room_id
        and rp.user_id = auth.uid()
    )
  );

-- Authenticated users can join a room (insert their own row)
create policy "room_players: authenticated users can join"
  on public.room_players for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Users can update their own room_player row (e.g. status on disconnect)
create policy "room_players: users can update own"
  on public.room_players for update
  to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------
-- games
-- ---------------------------------------------------------------
-- Room members can read the game
create policy "games: room members can read"
  on public.games for select
  to authenticated
  using (
    exists (
      select 1 from public.room_players rp
      where rp.room_id = games.room_id
        and rp.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------
-- rounds
-- ---------------------------------------------------------------
-- Room members can read rounds
create policy "rounds: room members can read"
  on public.rounds for select
  to authenticated
  using (
    exists (
      select 1 from public.games g
      join public.room_players rp on rp.room_id = g.room_id
      where g.id = rounds.game_id
        and rp.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------
-- hands
-- CRITICAL: players can only read their own hand
-- ---------------------------------------------------------------
create policy "hands: players can only read own hand"
  on public.hands for select
  to authenticated
  using (auth.uid() = player_id);

-- ---------------------------------------------------------------
-- bids
-- ---------------------------------------------------------------
-- Room members can read all bids (visible on scoreboard during bidding)
create policy "bids: room members can read"
  on public.bids for select
  to authenticated
  using (
    exists (
      select 1 from public.rounds r
      join public.games g on g.id = r.game_id
      join public.room_players rp on rp.room_id = g.room_id
      where r.id = bids.round_id
        and rp.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------
-- tricks + trick_cards
-- ---------------------------------------------------------------
-- Room members can read all tricks and cards played (public information)
create policy "tricks: room members can read"
  on public.tricks for select
  to authenticated
  using (
    exists (
      select 1 from public.rounds r
      join public.games g on g.id = r.game_id
      join public.room_players rp on rp.room_id = g.room_id
      where r.id = tricks.round_id
        and rp.user_id = auth.uid()
    )
  );

create policy "trick_cards: room members can read"
  on public.trick_cards for select
  to authenticated
  using (
    exists (
      select 1 from public.tricks t
      join public.rounds r on r.id = t.round_id
      join public.games g on g.id = r.game_id
      join public.room_players rp on rp.room_id = g.room_id
      where t.id = trick_cards.trick_id
        and rp.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------
-- round_scores + game_results
-- ---------------------------------------------------------------
-- Room members can read scores (visible scoreboard)
create policy "round_scores: room members can read"
  on public.round_scores for select
  to authenticated
  using (
    exists (
      select 1 from public.rounds r
      join public.games g on g.id = r.game_id
      join public.room_players rp on rp.room_id = g.room_id
      where r.id = round_scores.round_id
        and rp.user_id = auth.uid()
    )
  );

create policy "game_results: room members can read"
  on public.game_results for select
  to authenticated
  using (
    exists (
      select 1 from public.games g
      join public.room_players rp on rp.room_id = g.room_id
      where g.id = game_results.game_id
        and rp.user_id = auth.uid()
    )
  );

-- Note: INSERT/UPDATE policies for game state tables (rounds, hands, bids,
-- tricks, trick_cards, round_scores, game_results) are intentionally omitted
-- here. All game state writes go through API routes using the service_role key,
-- which bypasses RLS. This enforces that no client can write game state directly.
