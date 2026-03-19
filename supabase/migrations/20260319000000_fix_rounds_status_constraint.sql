-- The rounds.status check constraint allowed 'finished' but the application
-- writes 'complete'. Fix the constraint to match the application code.
ALTER TABLE public.rounds
  DROP CONSTRAINT IF EXISTS rounds_status_check;

ALTER TABLE public.rounds
  ADD CONSTRAINT rounds_status_check
  CHECK (status IN ('bidding', 'playing', 'complete'));

-- Recover any rounds left in 'playing' with all tricks resolved
-- (these were orphaned by the bug before this migration was applied).
UPDATE public.rounds r
SET status = 'complete', current_player_id = NULL
WHERE r.status = 'playing'
  AND NOT EXISTS (
    SELECT 1 FROM public.tricks t
    WHERE t.round_id = r.id AND t.winner_id IS NULL
  )
  AND EXISTS (
    SELECT 1 FROM public.tricks t
    WHERE t.round_id = r.id
  );
