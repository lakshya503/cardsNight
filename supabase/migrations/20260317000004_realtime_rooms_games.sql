-- Add rooms and games to Realtime publication so WaitingRoom and
-- GameBoard subscriptions receive Postgres Changes events.
alter publication supabase_realtime add table public.rooms;
alter publication supabase_realtime add table public.games;
