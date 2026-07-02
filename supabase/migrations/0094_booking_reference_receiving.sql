-- Dock2Door — Booking reference number + receiving check-in by reference
-- Gives every warehouse booking a human-readable reference number that the
-- customer knows and hands to the driver. Receiving staff type that reference,
-- the customer + cargo details load, they confirm arrival, and an inventory
-- receipt (ASN) is created/updated so the cargo can be putaway into the WMS.
-- Idempotent.

-- =========================================================================
-- 1. Human-readable reference number on warehouse_bookings
-- =========================================================================
-- Deterministic, unique (derived from the row id), always in sync.
alter table public.warehouse_bookings
  add column if not exists reference_number text
  generated always as ('WB-' || upper(substr(replace(id::text, '-', ''), 1, 8))) stored;

create index if not exists idx_bookings_reference on public.warehouse_bookings(reference_number);

-- =========================================================================
-- 2. Lookup a booking by its reference number (warehouse-side receiving)
-- =========================================================================
create or replace function public.warehouse_receiving_lookup(p_reference text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref text := upper(regexp_replace(coalesce(p_reference, ''), '\s', '', 'g'));
  v_booking public.warehouse_bookings;
  v_listing public.warehouse_listings;
  v_customer public.companies;
  v_receipt public.inventory_receipts;
  v_wh uuid;
begin
  if v_ref = '' then raise exception 'Enter a reference number'; end if;
  -- Accept the reference with or without the WB- prefix.
  if position('WB-' in v_ref) <> 1 then v_ref := 'WB-' || v_ref; end if;

  select * into v_booking from public.warehouse_bookings
    where upper(reference_number) = v_ref;
  if v_booking.id is null then
    raise exception 'No booking found for reference %', p_reference;
  end if;

  select * into v_listing from public.warehouse_listings where id = v_booking.listing_id;
  v_wh := coalesce(v_booking.warehouse_company_id, v_listing.company_id);

  if not (public.is_member_of(v_wh) or public.is_admin()) then
    raise exception 'You can only look up bookings for your own warehouse';
  end if;

  select * into v_customer from public.companies where id = v_booking.customer_company_id;
  select * into v_receipt from public.inventory_receipts
    where booking_id = v_booking.id
    order by created_at desc limit 1;

  return jsonb_build_object(
    'booking', to_jsonb(v_booking),
    'listing', to_jsonb(v_listing),
    'customer', to_jsonb(v_customer),
    'receipt', case when v_receipt.id is null then null else to_jsonb(v_receipt) end
  );
end; $$;
grant execute on function public.warehouse_receiving_lookup(text) to authenticated;

-- =========================================================================
-- 3. Confirm the cargo arrived — creates/updates the inventory receipt (ASN)
--    so the shipment is now "in the door" and ready for putaway into the WMS.
-- =========================================================================
create or replace function public.warehouse_confirm_receipt(
  p_reference text,
  p_carrier text default '',
  p_tracking text default '',
  p_notes text default ''
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref text := upper(regexp_replace(coalesce(p_reference, ''), '\s', '', 'g'));
  v_booking public.warehouse_bookings;
  v_listing public.warehouse_listings;
  v_wh uuid;
  v_receipt_id uuid;
begin
  if v_ref = '' then raise exception 'Enter a reference number'; end if;
  if position('WB-' in v_ref) <> 1 then v_ref := 'WB-' || v_ref; end if;

  select * into v_booking from public.warehouse_bookings
    where upper(reference_number) = v_ref;
  if v_booking.id is null then
    raise exception 'No booking found for reference %', p_reference;
  end if;

  select * into v_listing from public.warehouse_listings where id = v_booking.listing_id;
  v_wh := coalesce(v_booking.warehouse_company_id, v_listing.company_id);

  if not (public.is_member_of(v_wh) or public.is_admin()) then
    raise exception 'You can only receive cargo for your own warehouse';
  end if;

  -- Reuse an open receipt for this booking, otherwise create one.
  select id into v_receipt_id from public.inventory_receipts
    where booking_id = v_booking.id and status <> 'Completed'
    order by created_at desc limit 1;

  if v_receipt_id is null then
    insert into public.inventory_receipts (
      customer_company_id, warehouse_company_id, booking_id, reference_code,
      carrier, tracking_code, status, arrived_at, notes
    ) values (
      v_booking.customer_company_id, v_wh, v_booking.id, v_booking.reference_number,
      coalesce(p_carrier, ''), coalesce(p_tracking, ''), 'Arrived', now(), coalesce(p_notes, '')
    ) returning id into v_receipt_id;
  else
    update public.inventory_receipts set
      status = case when status in ('Draft', 'InTransit') then 'Arrived' else status end,
      arrived_at = coalesce(arrived_at, now()),
      carrier = case when coalesce(p_carrier, '') <> '' then p_carrier else carrier end,
      tracking_code = case when coalesce(p_tracking, '') <> '' then p_tracking else tracking_code end,
      notes = case when coalesce(p_notes, '') <> '' then p_notes else notes end,
      updated_at = now()
    where id = v_receipt_id;
  end if;

  return v_receipt_id;
end; $$;
grant execute on function public.warehouse_confirm_receipt(text, text, text, text) to authenticated;
