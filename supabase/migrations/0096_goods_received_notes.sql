-- Dock2Door — Goods Received Note (GRN)
-- After receiving staff confirm the cargo arrived and put it away into the WMS,
-- they inspect the shipment (condition + counts + notes) and issue a Goods
-- Received Note. The GRN is the permanent, printable proof that the warehouse
-- accepted the customer's cargo, what condition it was in, and how much was
-- actually received. It closes out the inbound receipt.
-- Idempotent.

-- =========================================================================
-- 1. goods_received_notes
-- =========================================================================
create table if not exists public.goods_received_notes (
  id uuid primary key default gen_random_uuid(),
  -- Human-readable, deterministic GRN number derived from the row id.
  grn_number text generated always as ('GRN-' || upper(substr(replace(id::text, '-', ''), 1, 8))) stored,
  booking_id uuid references public.warehouse_bookings(id) on delete set null,
  receipt_id uuid references public.inventory_receipts(id) on delete set null,
  customer_company_id uuid not null references public.companies(id) on delete cascade,
  warehouse_company_id uuid not null references public.companies(id) on delete cascade,
  -- Inspection outcome.
  inspection_status text not null default 'good'
    check (inspection_status in ('good', 'damaged', 'partial', 'rejected')),
  pallets_received integer not null default 0,
  pieces_received integer,
  condition_notes text not null default '',
  inspector_notes text not null default '',
  inspected_by uuid references public.profiles(id) on delete set null,
  issued_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists idx_grn_booking on public.goods_received_notes(booking_id);
create index if not exists idx_grn_customer on public.goods_received_notes(customer_company_id);
create index if not exists idx_grn_warehouse on public.goods_received_notes(warehouse_company_id);
alter table public.goods_received_notes enable row level security;

drop policy if exists "grn_read" on public.goods_received_notes;
create policy "grn_read" on public.goods_received_notes for select using (
  public.is_member_of(customer_company_id) or public.is_member_of(warehouse_company_id) or public.is_admin()
);

-- =========================================================================
-- 2. Issue a GRN — warehouse-only. Records inspection, closes the receipt.
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

  return to_jsonb(v_grn);
end; $$;
grant execute on function public.warehouse_issue_grn(uuid, text, integer, integer, text, text) to authenticated;
