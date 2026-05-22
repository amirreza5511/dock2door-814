-- 0055_provider_hide_unhide_service_listing.sql
--
-- Adds two provider-callable RPCs so that service providers can hide / unhide
-- their own Available listings without bypassing the audited state machine.
--
-- PROBLEM
-- -------
-- The web service-provider listings page previously called:
--   supabase.from("service_listings").update({ status }).eq("id", id)
-- directly, which:
--   a) bypasses the audit trail
--   b) allows a provider to self-approve (set status = 'Available')
--   c) is inconsistent with the mobile trpc.ts path that uses RPCs
--
-- RPCs added
-- ----------
--   provider_hide_service_listing(p_listing_id)
--     Available / Active → Hidden
--     Provider who is a member of the owning company (or admin) only.
--     Writes audit_logs.
--
--   provider_unhide_service_listing(p_listing_id)
--     Hidden → Available
--     Provider who is a member of the owning company (or admin) only.
--     Writes audit_logs.
--
-- Allowed provider-side transitions (complete picture):
--   Draft / Rejected → PendingApproval   via provider_submit_service_listing   (0051)
--   PendingApproval  → Draft             via provider_withdraw_service_listing  (0051)
--   Available / Active → Hidden          via provider_hide_service_listing      (THIS)
--   Hidden           → Available         via provider_unhide_service_listing    (THIS)
--
-- Admin-side transitions (any status) via admin_set_service_listing_status     (0052)
--
-- NO path allows a provider to self-approve (set status = Available / Active)
-- except by going through the PendingApproval → admin approval flow.
--
-- Idempotent — CREATE OR REPLACE.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. provider_hide_service_listing
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.provider_hide_service_listing(
  p_listing_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing public.service_listings;
begin
  if not public.is_authenticated() then
    raise exception 'not authenticated';
  end if;

  select * into v_listing from public.service_listings where id = p_listing_id;
  if v_listing is null then
    raise exception 'service listing not found';
  end if;

  if not (public.is_member_of(v_listing.company_id) or public.is_admin()) then
    raise exception 'only a member of the owning company can hide this listing';
  end if;

  -- Only Available / Active listings can be hidden by the provider
  if v_listing.status::text not in ('Available', 'Active') then
    raise exception 'listing must be Available or Active to hide (current: %)', v_listing.status;
  end if;

  update public.service_listings
  set status = 'Hidden'
  where id = p_listing_id;

  perform public.write_audit(
    'service_listing.hidden',
    'service_listings',
    p_listing_id::text,
    jsonb_build_object('status', v_listing.status),
    jsonb_build_object('status', 'Hidden'),
    'Listing hidden by provider',
    v_listing.company_id
  );
end;
$$;

grant execute on function public.provider_hide_service_listing(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. provider_unhide_service_listing
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.provider_unhide_service_listing(
  p_listing_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing public.service_listings;
begin
  if not public.is_authenticated() then
    raise exception 'not authenticated';
  end if;

  select * into v_listing from public.service_listings where id = p_listing_id;
  if v_listing is null then
    raise exception 'service listing not found';
  end if;

  if not (public.is_member_of(v_listing.company_id) or public.is_admin()) then
    raise exception 'only a member of the owning company can unhide this listing';
  end if;

  if v_listing.status::text <> 'Hidden' then
    raise exception 'listing must be Hidden to unhide (current: %)', v_listing.status;
  end if;

  -- Restore to Available (the last admin-approved status)
  update public.service_listings
  set status = 'Available'
  where id = p_listing_id;

  perform public.write_audit(
    'service_listing.unhidden',
    'service_listings',
    p_listing_id::text,
    jsonb_build_object('status', 'Hidden'),
    jsonb_build_object('status', 'Available'),
    'Listing unhidden by provider',
    v_listing.company_id
  );
end;
$$;

grant execute on function public.provider_unhide_service_listing(uuid) to authenticated;
