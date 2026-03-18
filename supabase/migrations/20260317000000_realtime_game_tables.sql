-- Enable Postgres Changes for game-state tables needed in M2.
alter publication supabase_realtime add table rounds;
alter publication supabase_realtime add table bids;
alter publication supabase_realtime add table trick_cards;
alter publication supabase_realtime add table tricks;
alter publication supabase_realtime add table round_scores;
