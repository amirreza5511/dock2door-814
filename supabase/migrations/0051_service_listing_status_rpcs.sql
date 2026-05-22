-- 0051_service_listing_status_rpcs.sql
-- Adds audited RPCs for service listing status transitions.
-- Mirrors the warehouse listing pattern from 0050 so that
-- services.setListingStatus in trpc.ts can route through proper
-- state-machine RPCs instead of direct service_listings UPDATE.
--
-- RPCs added:
--   provider_submit_service_listing(p_listing_id)  Draft → PendingApproval
--   provider_withdraw_service_listing(p_listing_id) PendingApproval → Draft
-- Both are SECURITY DEFINER, check membership, and write to audit_logs.
-- admin_set_listing_status (0007) already handles admin-side transitions for
-- all listing types; no admin-specific RPC is needed here.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. provider_submit_service_listing — provider submits listing for review
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.provider_submit_service_listing(
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
    raise exception 'listing not found';
  end if;

  if not (public.is_member_of(v_listing.company_id) or public.is_admin()) then
    raise exception 'only a member of the owning company can submit a listing for review';
  end if;

  if v_listing.status::text not in ('Draft', 'Rejected') then
    raise exception 'listing must be in Draft or Rejected status to submit for review (current: %)', v_listing.status;
  end if;

  update public.service_listings
  set status = 'PendingApproval'
  where id = p_listing_id;

  perform public.write_audit(
    'service_listing_submitted', 'service_listings', p_listing_id::text, null,
    jsonb_build_object('old_status', v_listing.status, 'new_status', 'PendingApproval'),
    'Submitted for admin review'
  );
end; $$;

grant execute on function public.provider_submit_service_listing(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. provider_withdraw_service_listing — provider withdraws from review
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.provider_withdraw_service_listing(
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
    raise exception 'listing not found';
  end if;

  if not (public.is_member_of(v_listing.company_id) or public.is_admin()) then
    raise exception 'only a member of the owning company can withdraw a listing from review';
  end if;

  if v_listing.status::text <> 'PendingApproval' then
    raise exception 'listing must be in PendingApproval status to withdraw (current: %)', v_listing.status;
  end if;

  update public.service_listings
  set status = 'Draft'
  where id = p_listing_id;

  perform public.write_audit(
    'service_listing_withdrawn', 'service_listings', p_listing_id::text, null,
    jsonb_build_object('old_status', 'PendingApproval', 'new_status', 'Draft'),
    'Withdrawn from review by provider'
  );
end; $$;

grant execute on function public.provider_withdraw_service_listing(uuid) to authenticated;
