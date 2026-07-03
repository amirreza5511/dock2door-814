-- Dock2Door — Pallet-slot putaway
-- Real warehouses rack ONE pallet per slot. Until now, putaway let an operator
-- dump all 22 pallets into a single location with a "quantity" field, which is
-- physically wrong. This migration models pallet slots properly:
--   * every location has a pallet_capacity (default 1 = one standard pallet)
--   * locations can be flagged to accept oversize / over-standard pallets
--   * a warehouse_pallets table tracks each physical pallet in its slot
--   * wms_putaway_pallet() places exactly ONE pallet into a slot, enforcing
--     capacity and pallet-type rules, and posts stock via the existing ledger.
-- Idempotent.

-- =========================================================================
-- 1. Location capacity + oversize capability
-- =========================================================================
alter table public.warehouse_locations
  add column if not exists pallet_capacity int not null default 1;

alter table public.warehouse_locations
  add column if not exists accepts_oversize boolean not null default false;

-- =========================================================================
-- 2. Pallet-level tracking (one row per physical pallet in a slot)
-- =========================================================================
create table if not exists public.warehouse_pallets (
  id uuid primary key default gen_random_uuid(),
  warehouse_company_id uuid not null references public.companies(id) on delete cascade,
  customer_company_id uuid references public.companies(id) on delete set null,
  location_id uuid not null references public.warehouse_locations(id) on delete restrict,
  variant_id uuid references public.product_variants(id) on delete set null,
  receipt_id uuid references public.inventory_receipts(id) on delete set null,
  booking_id uuid references public.warehouse_bookings(id) on delete set null,
  pallet_type text not null default 'standard',
  units numeric not null default 1,
  lot_code text default '',
  reference_code text default '',
  status text not null default 'stored',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_wpallets_location on public.warehouse_pallets(location_id) where status = 'stored';
create index if not exists idx_wpallets_wh on public.warehouse_pallets(warehouse_company_id);
alter table public.warehouse_pallets enable row level security;

drop policy if exists "wpallets_read" on public.warehouse_pallets;
create policy "wpallets_read" on public.warehouse_pallets for select using (
  public.is_member_of(warehouse_company_id) or public.is_member_of(customer_company_id) or public.is_admin()
);

-- =========================================================================
-- 3. Place ONE pallet into a slot (capacity + type enforced)
-- =========================================================================
create or replace function public.wms_putaway_pallet(
  p_variant_id uuid,
  p_location_id uuid,
  p_pallet_type text default 'standard',
  p_units numeric default 1,
  p_receipt_id uuid default null,
  p_lot_code text default null,
  p_expiry date default null,
  p_reference text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loc public.warehouse_locations;
  v_customer uuid;
  v_booking uuid;
  v_used int;
  v_units numeric;
  v_pallet_id uuid;
begin
  if p_pallet_type not in ('standard', 'oversize') then
    raise exception 'Invalid pallet type %', p_pallet_type;
  end if;

  select * into v_loc from public.warehouse_locations where id = p_location_id;
  if v_loc.id is null then raise exception 'Location not found'; end if;
  if not (public.is_member_of(v_loc.warehouse_company_id) or public.is_admin()) then
    raise exception 'Not authorized for this location';
  end if;

  -- Oversize pallets need an oversize-capable slot.
  if p_pallet_type = 'oversize' and not v_loc.accepts_oversize then
    raise exception 'This slot does not accept over-standard pallets. Choose an oversize-capable location.';
  end if;

  -- Enforce one-pallet-per-slot (or the location's configured capacity).
  select count(*) into v_used from public.warehouse_pallets
    where location_id = p_location_id and status = 'stored';
  if v_used >= greatest(coalesce(v_loc.pallet_capacity, 1), 1) then
    raise exception 'Slot is full (% of % pallets). Pick another location.', v_used, greatest(coalesce(v_loc.pallet_capacity, 1), 1);
  end if;

  v_units := greatest(coalesce(p_units, 1), 1);

  -- Resolve customer/booking from the linked receipt when available.
  if p_receipt_id is not null then
    select customer_company_id, booking_id into v_customer, v_booking
      from public.inventory_receipts where id = p_receipt_id;
  end if;

  -- Post the units to the stock ledger through the existing receive RPC
  -- (keeps stock_levels + stock_movements authoritative). Requires a receipt.
  if p_variant_id is not null and p_receipt_id is not null then
    perform public.wms_receive(p_receipt_id, p_variant_id, p_location_id, p_lot_code, p_expiry, v_units);
  end if;

  insert into public.warehouse_pallets (
    warehouse_company_id, customer_company_id, location_id, variant_id,
    receipt_id, booking_id, pallet_type, units, lot_code, reference_code, created_by
  ) values (
    v_loc.warehouse_company_id, v_customer, p_location_id, p_variant_id,
    p_receipt_id, v_booking, p_pallet_type, v_units,
    coalesce(p_lot_code, ''), coalesce(p_reference, ''), auth.uid()
  ) returning id into v_pallet_id;

  return v_pallet_id;
end; $$;
grant execute on function public.wms_putaway_pallet(uuid, uuid, text, numeric, uuid, text, date, text) to authenticated;
