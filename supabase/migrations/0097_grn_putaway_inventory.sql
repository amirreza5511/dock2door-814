-- Dock2Door — Close the receiving loop: GRN → inventory on hand
-- Until now, after a Goods Received Note was issued, the received pallets only
-- became usable stock if someone hand-typed SKU + quantity into the WMS. That
-- manual step was the weak link. This migration makes issuing the GRN the single
-- action that also posts the received goods into the booking's inventory, so the
-- customer can immediately create outbound orders (pick → pack → ship).
-- Idempotent.

-- =========================================================================
-- 1. Link inventory rows back to the GRN that created them (for dedupe).
-- =========================================================================
alter table public.booking_inventory
  add column if not exists grn_id uuid references public.goods_received_notes(id) on delete set null;

alter table public.booking_inventory
  add column if not exists source text not null default 'manual';

-- One inventory row per GRN at most (guards against double-posting).
create unique index if not exists uq_booking_inventory_grn
  on public.booking_inventory(grn_id) where grn_id is not null;

-- =========================================================================
-- 2. Re-define warehouse_issue_grn so it ALSO posts received goods to inventory.
--    Same signature + behaviour as before, plus the auto-inventory step.
-- =========================================================================
create or replace function public.warehouse_issue_grn(
  p_booking_id uuid,
  p_inspection_status text default 'good',
  p_pallets_received integer default 0,
  p_pieces_received integer default null,
  p_condition_notes text default '',
  p_inspector_notes text default ''
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.warehouse_bookings;
  v_listing public.warehouse_listings;
  v_wh uuid;
  v_receipt_id uuid;
  v_grn public.goods_received_notes;
  v_qty integer;
  v_sku text;
  v_name text;
  v_ref text;
begin
  if p_inspection_status not in ('good', 'damaged', 'partial', 'rejected') then
    raise exception 'Invalid inspection status %', p_inspection_status;
  end if;

  select * into v_booking from public.warehouse_bookings where id = p_booking_id;
  if v_booking.id is null then
    raise exception 'Booking not found';
  end if;

  select * into v_listing from public.warehouse_listings where id = v_booking.listing_id;
  v_wh := coalesce(v_booking.warehouse_company_id, v_listing.company_id);

  if not (public.is_member_of(v_wh) or public.is_admin()) then
    raise exception 'Only the warehouse can issue a goods received note';
  end if;

  -- Link the most recent inbound receipt for this booking, if any, and close it.
  select id into v_receipt_id from public.inventory_receipts
    where booking_id = v_booking.id
    order by created_at desc limit 1;

  if v_receipt_id is not null then
    update public.inventory_receipts set
      status = 'Completed',
      completed_at = coalesce(completed_at, now()),
      arrived_at = coalesce(arrived_at, now()),
      updated_at = now()
    where id = v_receipt_id;
  end if;

  insert into public.goods_received_notes (
    booking_id, receipt_id, customer_company_id, warehouse_company_id,
    inspection_status, pallets_received, pieces_received,
    condition_notes, inspector_notes, inspected_by
  ) values (
    v_booking.id, v_receipt_id, v_booking.customer_company_id, v_wh,
    p_inspection_status, greatest(coalesce(p_pallets_received, 0), 0), p_pieces_received,
    coalesce(p_condition_notes, ''), coalesce(p_inspector_notes, ''), auth.uid()
  ) returning * into v_grn;

  -- Post received goods to the booking's inventory (skip fully rejected loads).
  -- Prefer piece count when known, otherwise fall back to pallets received.
  if p_inspection_status <> 'rejected' then
    v_qty := coalesce(nullif(p_pieces_received, 0), nullif(greatest(coalesce(p_pallets_received, 0), 0), 0), 0);
    if v_qty > 0 then
      v_ref := coalesce(nullif(v_booking.reference_number, ''), 'WB-' || upper(substr(replace(v_booking.id::text, '-', ''), 1, 8)));
      v_name := coalesce(nullif(v_booking.cargo_description, ''), 'Received cargo');
      -- Use pieces as units when provided, else count pallets as the unit.
      v_sku := case when coalesce(nullif(p_pieces_received, 0), 0) > 0
                    then 'RCV-' || v_ref
                    else 'PALLET-' || v_ref end;
      insert into public.booking_inventory (booking_id, sku, name, quantity, grn_id, source)
        values (v_booking.id, v_sku, v_name, v_qty, v_grn.id, 'grn')
      on conflict (grn_id) where grn_id is not null do nothing;
    end if;
  end if;

  return to_jsonb(v_grn);
end; $$;
grant execute on function public.warehouse_issue_grn(uuid, text, integer, integer, text, text) to authenticated;
