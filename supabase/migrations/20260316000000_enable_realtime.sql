-- Enable Postgres Changes (Realtime) for tables that need live sync.
-- room_players drives the waiting room player list.
alter publication supabase_realtime add table room_players;
