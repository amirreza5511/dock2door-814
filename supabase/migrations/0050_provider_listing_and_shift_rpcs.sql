-- 0050_provider_listing_and_shift_rpcs.sql
--
-- Replaces the unsafe direct UPDATE paths in trpc.ts with audited SECURITY DEFINER RPCs:
--
-- 1. provider_submit_listing(p_listing_id)
--    Warehouse provider member moves their own listing Draft → PendingApproval.
--    Replaces the direct `update warehouse_listings set status = 'PendingApproval'`.
--
-- 2. provider_withdraw_listing(p_listing_id)
--    Warehouse provider member moves PendingApproval → Draft (pull-back before admin reviews).
--    Replaces the direct `update warehouse_listings set status = 'Draft'`.
--
-- 3. provider_set_shift_status(p_shift_id, p_status, p_reason)
--    Employer sets a shift to InProgress (shift day started) from Posted or Filled.
--    All other transitions are handled by dedicated RPCs:
--      Cancel  → cancel_shift_with_reason  (0024)
--      Close   → employer_close_shift_post  (0049)
--      Create  → INSERT with status = 'Posted'
--    Prevents callers from setting arbitrary statuses via a direct table update.
--
-- Idempotent — CREATE OR REPLACE.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. provider_submit_listing
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.provider_submit_listing(
  p_listing_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing   public.warehouse_listings;
  v_before    jsonb;
  v_after     jsonb;
begin
  select * into v_listing from public.warehouse_listings where id = p_listing_id;
  if not found then
    raise exception 'listing % not found', p_listing_id using errcode = 'P0002';
  end if;

  -- Caller must be a member of the listing's company or an admin
  if not (public.is_admin() or public.is_member_of(v_listing.company_id)) then
    raise exception 'Access denied: not a member of the listing company' using errcode = '42501';
  end if;

  -- Only Draft listings can be submitted for review
  if v_listing.status::text <> 'Draft' then
    raise exception 'Only Draft listings can be submitted for review (current: %)', v_listing.status;
  end if;

  v_before := to_jsonb(v_listing);

  update public.warehouse_listings
  set status = 'PendingApproval'
  where id = p_listing_id;

  select to_jsonb(wl.*) into v_after
  from public.warehouse_listings wl
  where id = p_listing_id;

  perform public.write_audit(
    'listing.submit_for_review', 'warehouse_listings', p_listing_id::text,
    v_before, v_after,
    'Provider submitted listing for admin review',
    v_listing.company_id
  );
end;
$$;

grant execute on function public.provider_submit_listing(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. provider_withdraw_listing
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.provider_withdraw_listing(
  p_listing_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing   public.warehouse_listings;
  v_before    jsonb;
  v_after     jsonb;
begin
  select * into v_listing from public.warehouse_listings where id = p_listing_id;
  if not found then
    raise exception 'listing % not found', p_listing_id using errcode = 'P0002';
  end if;

  if not (public.is_admin() or public.is_member_of(v_listing.company_id)) then
    raise exception 'Access denied: not a member of the listing company' using errcode = '42501';
  end if;

  -- Only PendingApproval listings can be withdrawn back to Draft
  if v_listing.status::text <> 'PendingApproval' then
    raise exception 'Only PendingApproval listings can be withdrawn (current: %)', v_listing.status;
  end if;

  v_before := to_jsonb(v_listing);

  update public.warehouse_listings
  set status = 'Draft'
  where id = p_listing_id;

  select to_jsonb(wl.*) into v_after
  from public.warehouse_listings wl
  where id = p_listing_id;

  perform public.write_audit(
    'listing.withdraw_from_review', 'warehouse_listings', p_listing_id::text,
    v_before, v_after,
    'Provider withdrew listing from review',
    v_listing.company_id
  );
end;
$$;

grant execute on function public.provider_withdraw_listing(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. provider_set_shift_status
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.provider_set_shift_status(
  p_shift_id uuid,
  p_status   text,
  p_reason   text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift   public.shift_posts;
  v_before  jsonb;
  v_after   jsonb;
begin
  select * into v_shift from public.shift_posts where id = p_shift_id;
  if not found then
    raise exception 'shift_post % not found', p_shift_id using errcode = 'P0002';
  end if;

  -- Caller must be employer company member or admin
  if not (public.is_admin() or public.is_member_of(v_shift.employer_company_id)) then
    raise exception 'Access denied: not a member of the employer company' using errcode = '42501';
  end if;

  -- Only these specific transitions are handled here.
  -- Cancel  → cancel_shift_with_reason
  -- Close   → employer_close_shift_post
  if p_status not in ('InProgress', 'Posted') then
    raise exception
      'provider_set_shift_status: status "%" not allowed here. Use cancel_shift_with_reason or employer_close_shift_post for other transitions.',
      p_status;
  end if;

  -- Validate source state
  if p_status = 'InProgress' and v_shift.status::text not in ('Posted', 'Filled') then
    raise exception 'Cannot mark InProgress from status %', v_shift.status;
  end if;
  if p_status = 'Posted' and v_shift.status::text not in ('Filled') then
    raise exception 'Can only revert to Posted from Filled (current: %)', v_shift.status;
  end if;

  v_before := to_jsonb(v_shift);

  update public.shift_posts
  set status = p_status::public.shift_status
  where id = p_shift_id;

  select to_jsonb(sp.*) into v_after
  from public.shift_posts sp
  where id = p_shift_id;

  perform public.write_audit(
    'shift.status_set', 'shift_posts', p_shift_id::text,
    v_before, v_after,
    coalesce(p_reason, 'Status updated to ' || p_status),
    v_shift.employer_company_id
  );
end;
$$;

grant execute on function public.provider_set_shift_status(uuid, text, text) to authenticated;
