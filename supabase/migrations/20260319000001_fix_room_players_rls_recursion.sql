-- Fix infinite recursion in room_players RLS policy.
--
-- Root cause: "room_players: room members can read" queried room_players inside
-- its own USING clause. Every table whose RLS policy joins through room_players
-- (rounds, bids, tricks, trick_cards, round_scores, game_results) triggered the
-- same recursion, causing all SELECT queries and Supabase Realtime event
-- delivery to fail with error 42P17.
--
-- Fix: introduce a SECURITY DEFINER helper that reads room_players bypassing
-- RLS. The room_players policy then calls this function instead of querying
-- room_players directly, breaking the cycle.

create or replace function public.is_room_member(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from room_players
    where room_id = p_room_id
      and user_id = auth.uid()
  );
$$;

-- Recreate the policy using the non-recursive helper.
drop policy if exists "room_players: room members can read" on public.room_players;

create policy "room_players: room members can read"
  on public.room_players for select
  to authenticated
  using (is_room_member(room_id));
