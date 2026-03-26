CREATE OR REPLACE FUNCTION public.claim_room_start(p_room_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE rooms
  SET status = 'in_progress'
  WHERE id = p_room_id AND status = 'waiting';

  RETURN FOUND;
END;
$$;
