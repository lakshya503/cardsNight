-- RLS read policies for game tables.
-- Realtime subscriptions run under the anon key, so without these
-- policies clients receive no Postgres Changes events.
--
-- Pattern: authenticated user who is a room_player for the game's room
-- can SELECT. hands is intentionally excluded — served via API only.

create policy "Players can read games for their rooms"
  on public.games for select to authenticated
  using (
    exists (
      select 1 from public.room_players rp
      where rp.room_id = games.room_id
        and rp.user_id = auth.uid()
    )
  );

create policy "Players can read rounds for their games"
  on public.rounds for select to authenticated
  using (
    exists (
      select 1 from public.games g
      join public.room_players rp on rp.room_id = g.room_id
      where g.id = rounds.game_id
        and rp.user_id = auth.uid()
    )
  );

create policy "Players can read bids for their games"
  on public.bids for select to authenticated
  using (
    exists (
      select 1 from public.rounds r
      join public.games g on g.id = r.game_id
      join public.room_players rp on rp.room_id = g.room_id
      where r.id = bids.round_id
        and rp.user_id = auth.uid()
    )
  );

create policy "Players can read tricks for their games"
  on public.tricks for select to authenticated
  using (
    exists (
      select 1 from public.rounds r
      join public.games g on g.id = r.game_id
      join public.room_players rp on rp.room_id = g.room_id
      where r.id = tricks.round_id
        and rp.user_id = auth.uid()
    )
  );

create policy "Players can read trick_cards for their games"
  on public.trick_cards for select to authenticated
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

create policy "Players can read round_scores for their games"
  on public.round_scores for select to authenticated
  using (
    exists (
      select 1 from public.rounds r
      join public.games g on g.id = r.game_id
      join public.room_players rp on rp.room_id = g.room_id
      where r.id = round_scores.round_id
        and rp.user_id = auth.uid()
    )
  );

create policy "Players can read game_results for their games"
  on public.game_results for select to authenticated
  using (
    exists (
      select 1 from public.games g
      join public.room_players rp on rp.room_id = g.room_id
      where g.id = game_results.game_id
        and rp.user_id = auth.uid()
    )
  );
