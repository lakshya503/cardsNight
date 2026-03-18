-- rooms and room_players need REPLICA IDENTITY FULL so Supabase Realtime
-- can deliver UPDATE events with full row data. Without it, non-PK column
-- filters (e.g. room_id=eq.{id} on room_players) may not work, and the
-- rooms UPDATE payload won't include current_game_id (needed for game-start redirect).
alter table public.rooms        replica identity full;
alter table public.room_players replica identity full;
