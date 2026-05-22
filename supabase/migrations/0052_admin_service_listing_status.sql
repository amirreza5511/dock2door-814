-- 0052_admin_service_listing_status.sql
--
-- Problem (confirmed in production audit):
--   services.setListingStatus in trpc.ts was calling admin_set_listing_status (0007)
--   for service_listings. But admin_set_listing_status only operates on
--   warehouse_listings — the UPDATE targets warehouse_listings, and the audit
--   company_id is extracted from warehouse_listings.company_id.
--   For service_listings this silently fails or updates the wrong table.
--
-- Fix:
--   Add admin_set_service_listing_status — mirrors admin_set_listing_status
--   exactly but operates on service_listings. Both are SECURITY DEFINER,
--   assert is_admin(), require a reason on destructive transitions, and write
--   a before/after audit entry to audit_logs.
--
-- Idempotent — CREATE OR REPLACE.

create or replace function public.admin_set_service_listing_status(
  p_listing_id uuid,
  p_status     listing_status,
  p_reason     text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
  v_after  jsonb;
begin
  perform public.require_admin();

  -- Reason is required for suspending or hiding a listing.
  if p_status in ('Suspended', 'Hidden') then
    perform public.require_reason(p_reason);
  end if;

  select to_jsonb(sl.*) into v_before
  from public.service_listings sl
  where id = p_listing_id;

  if v_before is null then
    raise exception 'service_listing % not found', p_listing_id using errcode = 'P0002';
  end if;

  update public.service_listings
  set status = p_status
  where id = p_listing_id;

  select to_jsonb(sl.*) into v_after
  from public.service_listings sl
  where id = p_listing_id;

  perform public.write_audit(
    'service_listing.set_status',
    'service_listings',
    p_listing_id::text,
    v_before,
    v_after,
    coalesce(p_reason, 'Status set to ' || p_status::text || ' by admin'),
    (v_after->>'company_id')::uuid
  );
end;
$$;

grant execute on function public.admin_set_service_listing_status(uuid, listing_status, text) to authenticated;
