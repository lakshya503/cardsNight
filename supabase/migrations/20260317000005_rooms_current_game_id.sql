-- Allows non-host players to obtain the gameId from a rooms UPDATE
-- Realtime payload without a separate fetch.
alter table public.rooms
  add column current_game_id uuid references public.games (id) on delete set null;
