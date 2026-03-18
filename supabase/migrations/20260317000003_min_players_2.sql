-- Allow rooms to be created with as few as 2 players.
-- Judgement supports 2-3 player games starting with 10 cards each.
alter table public.rooms
  drop constraint if exists rooms_max_players_check;

alter table public.rooms
  add constraint rooms_max_players_check
    check (max_players between 2 and 10);
