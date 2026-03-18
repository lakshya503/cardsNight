-- Postgres Changes payloads only include columns in the replica identity.
-- Without FULL, INSERT events on bids/tricks won't include round_id/trick_id
-- in payload.new, breaking the Realtime filters in GameShell.
alter table public.bids    replica identity full;
alter table public.tricks  replica identity full;
