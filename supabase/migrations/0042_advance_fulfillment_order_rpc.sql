-- 0042_advance_fulfillment_order_rpc.sql
-- Enforces fulfillment order status transitions server-side via a SECURITY DEFINER RPC.
-- This prevents:
--   1. Status jumps (e.g. Draft → Shipped, skipping intermediate states)
--   2. Race conditions (two concurrent updates misapplying "next" state)
--   3. RLS bypass via direct UPDATE

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. Source-of-truth transition table
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fulfillment_order_transitions (
  from_status text NOT NULL,
  to_status   text NOT NULL,
  PRIMARY KEY (from_status, to_status)
);

-- Idempotent inserts
INSERT INTO public.fulfillment_order_transitions (from_status, to_status) VALUES
  ('Draft',     'Received'),
  ('Draft',     'Cancelled'),
  ('Received',  'Picking'),
  ('Received',  'Cancelled'),
  ('Picking',   'Packed'),
  ('Picking',   'Cancelled'),
  ('Packed',    'Shipped'),
  ('Packed',    'Cancelled'),
  ('Shipped',   'Completed'),
  ('Shipped',   'Cancelled')
ON CONFLICT DO NOTHING;

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. RPC: advance_fulfillment_order
--    Validates the transition, then applies it.
--    Returns the new status on success; raises an exception on invalid transition.
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.advance_fulfillment_order(
  p_order_id   uuid,
  p_next_status text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_status text;
  v_company_id     uuid;
BEGIN
  -- Lock the row to prevent concurrent transitions
  SELECT status, provider_company_id
  INTO   v_current_status, v_company_id
  FROM   public.fulfillment_orders
  WHERE  id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'fulfillment_order % not found', p_order_id;
  END IF;

  -- Membership check: caller must be a member of the provider company
  IF v_company_id IS NOT NULL THEN
    IF NOT (public.is_member_of(v_company_id) OR public.is_admin()) THEN
      RAISE EXCEPTION 'Access denied: not a member of the provider company';
    END IF;
  END IF;

  -- Validate transition
  IF NOT EXISTS (
    SELECT 1 FROM public.fulfillment_order_transitions
    WHERE from_status = v_current_status
      AND to_status   = p_next_status
  ) THEN
    RAISE EXCEPTION 'Invalid transition: % → % is not allowed', v_current_status, p_next_status;
  END IF;

  -- Apply
  UPDATE public.fulfillment_orders
  SET    status     = p_next_status,
         updated_at = now()
  WHERE  id = p_order_id;

  RETURN p_next_status;
END;
$$;

GRANT EXECUTE ON FUNCTION public.advance_fulfillment_order(uuid, text) TO authenticated;
