-- Dock2Door — Inventory / WMS-lite
-- locations/bins, lots, stock_levels, stock_movements, receipts, ASNs, cycle counts, reservations
-- Idempotent.

-- =========================================================================
-- ENUMS
-- =========================================================================
do $$ begin
  create type stock_movement_kind as enum (
    'receive','putaway','pick','pack','ship','adjust','transfer','return','cycle_count'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type receipt_status as enum ('Draft','InTransit','Arrived','Receiving','Completed','Cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type reservation_status as enum ('Active','Consumed','Cancelled','Expired');
exception when duplicate_object then null; end $$;

-- =========================================================================
-- LOCATIONS / BINS (warehouse-owned)
-- =========================================================================
create table if not exists public.warehouse_locations (
  id uuid primary key default gen_random_uuid(),
  warehouse_company_id uuid not null references public.companies(id) on delete cascade,
  listing_id uuid references public.warehouse_listings(id) on delete set null,
  code text not null,
  zone text default '',
  aisle text default '',
  rack text default '',
  level text default '',
  bin text default '',
  kind text not null default 'storage',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (warehouse_company_id, code)
);
create index if not exists idx_wloc_company on public.warehouse_locations(warehouse_company_id);
alter table public.warehouse_locations enable row level security;

-- =========================================================================
-- LOTS / BATCHES
-- =========================================================================
create table if not exists public.inventory_lots (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.product_variants(id) on delete cascade,
  lot_code text not null,
  expiry_date date,
  received_at timestamptz,
  created_at timestamptz not null default now(),
  unique (variant_id, lot_code)
);
alter table public.inventory_lots enable row level security;

-- =========================================================================
-- STOCK LEVELS (on-hand, snapshot per variant/location/lot)
-- =========================================================================
create table if not exists public.stock_levels (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.product_variants(id) on delete cascade,
  location_id uuid not null references public.warehouse_locations(id) on delete cascade,
  lot_id uuid references public.inventory_lots(id) on delete set null,
  customer_company_id uuid references public.companies(id) on delete set null,
  warehouse_company_id uuid references public.companies(id) on delete cascade,
  on_hand numeric not null default 0,
  reserved numeric not null default 0,
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_stock_levels_combo on public.stock_levels(variant_id, location_id, coalesce(lot_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists idx_stock_levels_wh on public.stock_levels(warehouse_company_id);
create index if not exists idx_stock_levels_customer on public.stock_levels(customer_company_id);
alter table public.stock_levels enable row level security;

-- =========================================================================
-- STOCK MOVEMENTS (append-only ledger)
-- =========================================================================
create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  kind stock_movement_kind not null,
  variant_id uuid not null references public.product_variants(id) on delete cascade,
  lot_id uuid references public.inventory_lots(id) on delete set null,
  from_location_id uuid references public.warehouse_locations(id) on delete set null,
  to_location_id uuid references public.warehouse_locations(id) on delete set null,
  quantity numeric not null,
  customer_company_id uuid references public.companies(id) on delete set null,
  warehouse_company_id uuid references public.companies(id) on delete set null,
  reference_kind text,
  reference_id uuid,
  actor_user_id uuid references public.profiles(id) on delete set null,
  notes text default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_movements_variant on public.stock_movements(variant_id);
create index if not exists idx_movements_ref on public.stock_movements(reference_kind, reference_id);
alter table public.stock_movements enable row level security;

-- =========================================================================
-- RECEIPTS / ASNs
-- =========================================================================
create table if not exists public.inventory_receipts (
  id uuid primary key default gen_random_uuid(),
  customer_company_id uuid not null references public.companies(id) on delete cascade,
  warehouse_company_id uuid not null references public.companies(id) on delete cascade,
  booking_id uuid references public.warehouse_bookings(id) on delete set null,
  reference_code text default '',
  carrier text default '',
  tracking_code text default '',
  status receipt_status not null default 'Draft',
  expected_at timestamptz,
  arrived_at timestamptz,
  completed_at timestamptz,
  notes text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_receipts_customer on public.inventory_receipts(customer_company_id);
create index if not exists idx_receipts_wh on public.inventory_receipts(warehouse_company_id);
alter table public.inventory_receipts enable row level security;

create table if not exists public.receipt_items (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.inventory_receipts(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id) on delete cascade,
  lot_code text default '',
  expiry_date date,
  expected_qty numeric not null default 0,
  received_qty numeric not null default 0,
  putaway_location_id uuid references public.warehouse_locations(id) on delete set null
);
alter table public.receipt_items enable row level security;

-- =========================================================================
-- RESERVATIONS (for allocation to orders)
-- =========================================================================
create table if not exists public.inventory_reservations (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.product_variants(id) on delete cascade,
  lot_id uuid references public.inventory_lots(id) on delete set null,
  location_id uuid references public.warehouse_locations(id) on delete set null,
  quantity numeric not null default 0,
  order_id uuid references public.fulfillment_orders(id) on delete cascade,
  customer_company_id uuid references public.companies(id) on delete set null,
  warehouse_company_id uuid references public.companies(id) on delete set null,
  status reservation_status not null default 'Active',
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_resv_order on public.inventory_reservations(order_id);
alter table public.inventory_reservations enable row level security;

-- =========================================================================
-- CYCLE COUNTS
-- =========================================================================
create table if not exists public.cycle_counts (
  id uuid primary key default gen_random_uuid(),
  warehouse_company_id uuid not null references public.companies(id) on delete cascade,
  location_id uuid references public.warehouse_locations(id) on delete set null,
  variant_id uuid references public.product_variants(id) on delete set null,
  counted_qty numeric not null default 0,
  system_qty numeric not null default 0,
  variance numeric generated always as (counted_qty - system_qty) stored,
  counted_by uuid references public.profiles(id) on delete set null,
  counted_at timestamptz not null default now()
);
alter table public.cycle_counts enable row level security;

-- =========================================================================
-- RLS
-- =========================================================================
drop policy if exists "wloc_read" on public.warehouse_locations;
create policy "wloc_read" on public.warehouse_locations for select using (public.is_member_of(warehouse_company_id) or public.is_admin());
drop policy if exists "wloc_write" on public.warehouse_locations;
create policy "wloc_write" on public.warehouse_locations for all
  using (public.is_member_of(warehouse_company_id))
  with check (public.is_member_of(warehouse_company_id));

drop policy if exists "lots_read" on public.inventory_lots;
create policy "lots_read" on public.inventory_lots for select using (
  exists (select 1 from public.product_variants v join public.products p on p.id = v.product_id
          where v.id = inventory_lots.variant_id and (public.is_member_of(p.company_id) or public.is_admin()))
);

drop policy if exists "stock_read" on public.stock_levels;
create policy "stock_read" on public.stock_levels for select using (
  public.is_member_of(warehouse_company_id) or public.is_member_of(customer_company_id) or public.is_admin()
);

drop policy if exists "movements_read" on public.stock_movements;
create policy "movements_read" on public.stock_movements for select using (
  public.is_member_of(warehouse_company_id) or public.is_member_of(customer_company_id) or public.is_admin()
);

drop policy if exists "receipts_read" on public.inventory_receipts;
create policy "receipts_read" on public.inventory_receipts for select using (
  public.is_member_of(customer_company_id) or public.is_member_of(warehouse_company_id) or public.is_admin()
);
drop policy if exists "receipts_write_customer" on public.inventory_receipts;
create policy "receipts_write_customer" on public.inventory_receipts for insert
  with check (public.is_member_of(customer_company_id));
drop policy if exists "receipts_update_parties" on public.inventory_receipts;
create policy "receipts_update_parties" on public.inventory_receipts for update
  using (public.is_member_of(customer_company_id) or public.is_member_of(warehouse_company_id) or public.is_admin())
  with check (public.is_member_of(customer_company_id) or public.is_member_of(warehouse_company_id) or public.is_admin());

drop policy if exists "receipt_items_read" on public.receipt_items;
create policy "receipt_items_read" on public.receipt_items for select using (
  exists (select 1 from public.inventory_receipts r where r.id = receipt_items.receipt_id
          and (public.is_member_of(r.customer_company_id) or public.is_member_of(r.warehouse_company_id) or public.is_admin()))
);
drop policy if exists "receipt_items_write" on public.receipt_items;
create policy "receipt_items_write" on public.receipt_items for all using (
  exists (select 1 from public.inventory_receipts r where r.id = receipt_items.receipt_id
          and (public.is_member_of(r.customer_company_id) or public.is_member_of(r.warehouse_company_id) or public.is_admin()))
) with check (
  exists (select 1 from public.inventory_receipts r where r.id = receipt_items.receipt_id
          and (public.is_member_of(r.customer_company_id) or public.is_member_of(r.warehouse_company_id) or public.is_admin()))
);

drop policy if exists "resv_read" on public.inventory_reservations;
create policy "resv_read" on public.inventory_reservations for select using (
  public.is_member_of(warehouse_company_id) or public.is_member_of(customer_company_id) or public.is_admin()
);

drop policy if exists "cc_read" on public.cycle_counts;
create policy "cc_read" on public.cycle_counts for select using (public.is_member_of(warehouse_company_id) or public.is_admin());
drop policy if exists "cc_write" on public.cycle_counts;
create policy "cc_write" on public.cycle_counts for insert with check (public.is_member_of(warehouse_company_id));

-- =========================================================================
-- RPCs — stock movements (authoritative ledger)
-- =========================================================================

-- Receive stock: bumps on_hand at a location for variant+lot, logs movement
create or replace function public.wms_receive(
  p_receipt_id uuid,
  p_variant_id uuid,
  p_location_id uuid,
  p_lot_code text,
  p_expiry date,
  p_qty numeric
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_receipt public.inventory_receipts;
  v_lot_id uuid;
  v_level_id uuid;
  v_move_id uuid;
begin
  if p_qty <= 0 then raise exception 'qty must be > 0'; end if;
  select * into v_receipt from public.inventory_receipts where id = p_receipt_id;
  if v_receipt is null then raise exception 'receipt not found'; end if;
  if not (public.is_member_of(v_receipt.warehouse_company_id) or public.is_admin()) then
    raise exception 'only warehouse can receive';
  end if;

  if coalesce(p_lot_code, '') <> '' then
    insert into public.inventory_lots(variant_id, lot_code, expiry_date, received_at)
      values (p_variant_id, p_lot_code, p_expiry, now())
      on conflict (variant_id, lot_code) do update set expiry_date = coalesce(excluded.expiry_date, inventory_lots.expiry_date)
      returning id into v_lot_id;
  end if;

  insert into public.stock_levels (variant_id, location_id, lot_id, customer_company_id, warehouse_company_id, on_hand)
    values (p_variant_id, p_location_id, v_lot_id, v_receipt.customer_company_id, v_receipt.warehouse_company_id, p_qty)
  on conflict (variant_id, location_id, coalesce(lot_id, '00000000-0000-0000-0000-000000000000'::uuid))
    do update set on_hand = stock_levels.on_hand + excluded.on_hand, updated_at = now()
  returning id into v_level_id;

  insert into public.stock_movements (
    kind, variant_id, lot_id, to_location_id, quantity,
    customer_company_id, warehouse_company_id, reference_kind, reference_id, actor_user_id
  ) values (
    'receive', p_variant_id, v_lot_id, p_location_id, p_qty,
    v_receipt.customer_company_id, v_receipt.warehouse_company_id, 'receipt', p_receipt_id, auth.uid()
  ) returning id into v_move_id;

  update public.inventory_receipts set status = 'Receiving', arrived_at = coalesce(arrived_at, now()), updated_at = now()
    where id = p_receipt_id and status in ('Draft','InTransit','Arrived');

  return v_move_id;
end; $$;
grant execute on function public.wms_receive(uuid, uuid, uuid, text, date, numeric) to authenticated;

-- Adjust stock with audit
create or replace function public.wms_adjust(
  p_variant_id uuid, p_location_id uuid, p_lot_id uuid, p_delta numeric, p_reason text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_loc public.warehouse_locations; v_move_id uuid;
begin
  perform public.require_reason(p_reason);
  select * into v_loc from public.warehouse_locations where id = p_location_id;
  if v_loc is null then raise exception 'location not found'; end if;
  if not (public.is_member_of(v_loc.warehouse_company_id) or public.is_admin()) then raise exception 'not authorized'; end if;

  insert into public.stock_levels (variant_id, location_id, lot_id, warehouse_company_id, on_hand)
    values (p_variant_id, p_location_id, p_lot_id, v_loc.warehouse_company_id, p_delta)
    on conflict (variant_id, location_id, coalesce(lot_id, '00000000-0000-0000-0000-000000000000'::uuid))
      do update set on_hand = greatest(stock_levels.on_hand + excluded.on_hand, 0), updated_at = now();

  insert into public.stock_movements (kind, variant_id, lot_id, to_location_id, quantity, warehouse_company_id, actor_user_id, notes)
    values ('adjust', p_variant_id, p_lot_id, p_location_id, p_delta, v_loc.warehouse_company_id, auth.uid(), p_reason)
  returning id into v_move_id;

  perform public.write_audit('stock_adjust', 'stock_levels', null, null,
    jsonb_build_object('variant', p_variant_id, 'delta', p_delta), p_reason);
  return v_move_id;
end; $$;
grant execute on function public.wms_adjust(uuid, uuid, uuid, numeric, text) to authenticated;

-- Reserve stock for an order
create or replace function public.wms_reserve(p_order_id uuid, p_variant_id uuid, p_qty numeric)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_resv_id uuid; v_order public.fulfillment_orders;
begin
  select * into v_order from public.fulfillment_orders where id = p_order_id;
  if v_order is null then raise exception 'order not found'; end if;
  if not (public.is_member_of(v_order.customer_company_id) or public.is_member_of(v_order.provider_company_id) or public.is_admin()) then
    raise exception 'not authorized';
  end if;
  insert into public.inventory_reservations (variant_id, order_id, quantity, status, customer_company_id, warehouse_company_id)
    values (p_variant_id, p_order_id, p_qty, 'Active', v_order.customer_company_id, v_order.provider_company_id)
  returning id into v_resv_id;
  return v_resv_id;
end; $$;
grant execute on function public.wms_reserve(uuid, uuid, numeric) to authenticated;
