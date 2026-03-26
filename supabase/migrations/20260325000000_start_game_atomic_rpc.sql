-- Called exclusively by the service-role (admin) client in the start route.
-- No GRANT EXECUTE to authenticated/anon roles is intentional — user-context
-- callers must not be able to invoke this directly.
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
