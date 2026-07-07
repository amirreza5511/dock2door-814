-- =========================================================================
-- 0111 — Assigned drayage drivers can read their order (fixes empty driver page)
-- Idempotent.
--
-- Symptom: dispatch assigns a container move to a driver (pdri1). On the
-- dispatch/order pages everything shows, but the driver's "Drayage Work
-- Orders" page is EMPTY — no assigned moves appear.
--
-- Root cause: the driver's query is
--     from drayage_moves select *, drayage_orders!inner(*)
--     where driver_user_id = auth.uid()
-- The `drayage_moves` RLS policy lets the assigned driver read the move row
-- (driver_user_id = auth.uid()), BUT the embedded `drayage_orders!inner(*)`
-- is filtered by the drayage_orders RLS policy, which had NO clause for the
-- assigned driver — only the customer, the drayage company members, the
-- warehouse members, or Open orders. Once an order is Dispatched it is no
-- longer 'Open', so the driver cannot read the parent order → the INNER join
-- drops every row → the driver sees nothing.
--
-- Fix: allow the assigned driver to read the parent order. To avoid mutual
-- RLS recursion (drayage_moves policy references drayage_orders and vice
-- versa), the driver check runs inside a SECURITY DEFINER helper that bypasses
-- RLS on drayage_moves.
-- =========================================================================

-- 1) SECURITY DEFINER helper: is the current user the assigned driver on any
--    move of this order? Bypasses RLS so it can't recurse into the policies.
create or replace function public.is_drayage_order_driver(p_order_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.drayage_moves m
    where m.order_id = p_order_id
      and m.driver_user_id = auth.uid()
  );
$$;

grant execute on function public.is_drayage_order_driver(uuid) to authenticated;

-- 2) Recreate the read policy WITH the assigned-driver clause (keeps the
--    targeted-Open-order rules from migration 0103).
drop policy if exists "drayage_orders_read" on public.drayage_orders;
create policy "drayage_orders_read" on public.drayage_orders for select using (
  public.is_admin()
  or (customer_company_id is not null and public.is_member_of(customer_company_id))
  or (customer_user_id = auth.uid())
  or (drayage_company_id is not null and public.is_member_of(drayage_company_id))
  or (warehouse_company_id is not null and public.is_member_of(warehouse_company_id))
  or (status = 'Open' and target_drayage_company_id is null)
  or (status = 'Open' and target_drayage_company_id is not null and public.is_member_of(target_drayage_company_id))
  -- NEW: the driver assigned to any move of this order can read it, so their
  -- work-order list (drayage_moves + drayage_orders!inner) is no longer empty.
  or public.is_drayage_order_driver(id)
);

-- 3) Refresh PostgREST schema cache so the new function/policy apply immediately.
notify pgrst, 'reload schema';
