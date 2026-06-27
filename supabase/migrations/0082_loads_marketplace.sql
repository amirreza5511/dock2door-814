-- Dock2Door — "Uber for Trucks" load marketplace
-- Idempotent. Adds a freight load marketplace where shippers / trucking companies
-- post loads, drivers accept them, and the platform earns a commission + booking fee
-- that flows through the existing finance layer (invoices / payments / payouts).

-- =========================================================================
-- 1) PLATFORM SETTINGS — trucking commission + booking fee
-- =========================================================================
alter table public.platform_settings add column if not exists trucking_commission_percentage numeric not null default 12;
alter table public.platform_settings add column if not exists trucking_booking_fee numeric not null default 5;

-- Optional marketplace tag on payments so Finance can break commission down by area.
alter table public.payments add column if not exists category text;

-- Extend the audited settings RPC to also persist the trucking knobs.
-- Keeps the original 5-arg version working; adds a 7-arg overload the shim calls.
create or replace function public.admin_update_platform_settings(
  p_warehouse_commission_percentage  numeric,
  p_service_commission_percentage    numeric,
  p_labour_commission_percentage     numeric,
  p_handling_fee_per_pallet_default  numeric,
  p_tax_mode                         text,
  p_trucking_commission_percentage   numeric,
  p_trucking_booking_fee             numeric
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_id     uuid;
  v_before jsonb;
  v_after  jsonb;
begin
  perform public.require_admin();

  select id into v_id from public.platform_settings limit 1;
  if v_id is null then
    raise exception 'platform_settings row not found' using errcode = 'P0002';
  end if;

  select to_jsonb(p.*) into v_before from public.platform_settings p where id = v_id;

  update public.platform_settings set
    warehouse_commission_percentage  = p_warehouse_commission_percentage,
    service_commission_percentage    = p_service_commission_percentage,
    labour_commission_percentage     = p_labour_commission_percentage,
    handling_fee_per_pallet_default  = p_handling_fee_per_pallet_default,
    tax_mode                         = p_tax_mode,
    trucking_commission_percentage   = p_trucking_commission_percentage,
    trucking_booking_fee             = p_trucking_booking_fee,
    updated_at                       = now()
  where id = v_id;

  select to_jsonb(p.*) into v_after from public.platform_settings p where id = v_id;

  perform public.write_audit(
    'platform_settings.update', 'platform_settings', v_id::text, v_before, v_after
  );
end;
$$;
grant execute on function public.admin_update_platform_settings(numeric, numeric, numeric, numeric, text, numeric, numeric) to authenticated;

-- =========================================================================
-- 2) VEHICLE TYPE ENUM + LOAD STATUS ENUM
-- =========================================================================
do $$ begin
  create type load_vehicle_type as enum
    ('Bicycle','Motorcycle','Car','Pickup','MovingTruck','FiveTon','FlatDeck','Semi');
exception when duplicate_object then null; end $$;

do $$ begin
  create type load_status as enum
    ('Open','Accepted','EnRoute','Arrived','Delivered','Cancelled');
exception when duplicate_object then null; end $$;

-- =========================================================================
-- 3) LOADS TABLE
-- =========================================================================
create table if not exists public.loads (
  id uuid primary key default gen_random_uuid(),
  poster_user_id uuid not null references public.profiles(id) on delete cascade,
  poster_company_id uuid references public.companies(id) on delete set null,

  pickup_lat numeric not null,
  pickup_lng numeric not null,
  pickup_address text not null default '',
  pickup_city text not null default '',
  dropoff_lat numeric not null,
  dropoff_lng numeric not null,
  dropoff_address text not null default '',
  dropoff_city text not null default '',

  vehicle_type load_vehicle_type not null default 'Pickup',
  pallets int not null default 1,
  delivery_speed text not null default 'NextDay' check (delivery_speed in ('SameDay','NextDay')),
  notes text not null default '',

  distance_km numeric not null default 0,
  freight_price numeric not null default 0,
  commission_amount numeric not null default 0,
  booking_fee numeric not null default 0,
  platform_earnings numeric not null default 0,
  provider_net numeric not null default 0,
  total_price numeric not null default 0,
  currency text not null default 'CAD',

  status load_status not null default 'Open',
  accepted_driver_user_id uuid references public.profiles(id) on delete set null,
  accepted_company_id uuid references public.companies(id) on delete set null,
  accepted_at timestamptz,

  invoice_id uuid references public.invoices(id) on delete set null,
  payment_id uuid references public.payments(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index if not exists idx_loads_status on public.loads(status);
create index if not exists idx_loads_vehicle on public.loads(vehicle_type);
create index if not exists idx_loads_poster on public.loads(poster_user_id);
create index if not exists idx_loads_poster_company on public.loads(poster_company_id);
create index if not exists idx_loads_driver on public.loads(accepted_driver_user_id);
create index if not exists idx_loads_company on public.loads(accepted_company_id);

alter table public.loads enable row level security;

-- Open loads are visible to any authenticated user (drivers browse the marketplace);
-- participants always keep visibility to their own loads.
drop policy if exists "loads_read" on public.loads;
create policy "loads_read" on public.loads for select using (
  public.is_authenticated()
);

-- All writes go through SECURITY DEFINER RPCs below; no direct client writes.
drop policy if exists "loads_write_admin" on public.loads;
create policy "loads_write_admin" on public.loads for all using (public.is_admin()) with check (public.is_admin());

-- =========================================================================
-- 4) PRICE QUOTE — pure function (no writes), used by post + UI parity
-- =========================================================================
-- Haversine distance in km between two lat/lng points.
create or replace function public.load_distance_km(
  p_lat1 numeric, p_lng1 numeric, p_lat2 numeric, p_lng2 numeric
) returns numeric language sql immutable as $$
  select round((6371 * 2 * asin(sqrt(
    power(sin(radians(p_lat2 - p_lat1) / 2), 2) +
    cos(radians(p_lat1)) * cos(radians(p_lat2)) *
    power(sin(radians(p_lng2 - p_lng1) / 2), 2)
  )))::numeric, 2);
$$;

-- Returns the price breakdown for a hypothetical load. Reads live commission settings.
create or replace function public.quote_load(
  p_pickup_lat numeric, p_pickup_lng numeric,
  p_dropoff_lat numeric, p_dropoff_lng numeric,
  p_vehicle_type load_vehicle_type,
  p_pallets int,
  p_delivery_speed text
) returns jsonb language plpgsql stable set search_path = public as $$
declare
  v_distance numeric;
  v_base numeric;
  v_per_km numeric;
  v_per_pallet numeric := 8;
  v_speed_mult numeric;
  v_freight numeric;
  v_commission_pct numeric := 12;
  v_booking_fee numeric := 5;
  v_commission numeric;
  v_platform numeric;
begin
  v_distance := public.load_distance_km(p_pickup_lat, p_pickup_lng, p_dropoff_lat, p_dropoff_lng);

  -- Per-vehicle base + per-km rate (CAD).
  case p_vehicle_type
    when 'Bicycle'     then v_base := 6;   v_per_km := 1.2;
    when 'Motorcycle'  then v_base := 8;   v_per_km := 1.5;
    when 'Car'         then v_base := 12;  v_per_km := 1.8;
    when 'Pickup'      then v_base := 25;  v_per_km := 2.2;
    when 'MovingTruck' then v_base := 60;  v_per_km := 3.0;
    when 'FiveTon'     then v_base := 90;  v_per_km := 3.5;
    when 'FlatDeck'    then v_base := 120; v_per_km := 4.0;
    when 'Semi'        then v_base := 200; v_per_km := 4.5;
    else v_base := 25; v_per_km := 2.2;
  end case;

  v_speed_mult := case when p_delivery_speed = 'SameDay' then 1.4 else 1.0 end;

  v_freight := round((v_base + v_per_km * v_distance + v_per_pallet * greatest(coalesce(p_pallets, 0), 0)) * v_speed_mult, 2);

  select coalesce(trucking_commission_percentage, 12), coalesce(trucking_booking_fee, 5)
    into v_commission_pct, v_booking_fee
    from public.platform_settings limit 1;

  v_commission := round(v_freight * (v_commission_pct / 100.0), 2);
  v_platform := round(v_commission + v_booking_fee, 2);

  return jsonb_build_object(
    'distanceKm', v_distance,
    'freightPrice', v_freight,
    'commissionPct', v_commission_pct,
    'commissionAmount', v_commission,
    'bookingFee', v_booking_fee,
    'platformEarnings', v_platform,
    'providerNet', round(v_freight - v_commission, 2),
    'totalPrice', round(v_freight + v_booking_fee, 2),
    'currency', 'CAD'
  );
end;
$$;
grant execute on function public.quote_load(numeric, numeric, numeric, numeric, load_vehicle_type, int, text) to authenticated;

-- =========================================================================
-- 5) POST A LOAD — shipper or trucking company creates an Open load
-- =========================================================================
create or replace function public.post_load(
  p_pickup_lat numeric, p_pickup_lng numeric, p_pickup_address text, p_pickup_city text,
  p_dropoff_lat numeric, p_dropoff_lng numeric, p_dropoff_address text, p_dropoff_city text,
  p_vehicle_type load_vehicle_type,
  p_pallets int,
  p_delivery_speed text,
  p_notes text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_q jsonb;
  v_company uuid;
  v_id uuid;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  if p_delivery_speed not in ('SameDay','NextDay') then raise exception 'invalid delivery speed'; end if;

  v_q := public.quote_load(p_pickup_lat, p_pickup_lng, p_dropoff_lat, p_dropoff_lng, p_vehicle_type, p_pallets, p_delivery_speed);
  select company_id into v_company from public.profiles where id = auth.uid();

  insert into public.loads (
    poster_user_id, poster_company_id,
    pickup_lat, pickup_lng, pickup_address, pickup_city,
    dropoff_lat, dropoff_lng, dropoff_address, dropoff_city,
    vehicle_type, pallets, delivery_speed, notes,
    distance_km, freight_price, commission_amount, booking_fee,
    platform_earnings, provider_net, total_price, currency, status
  ) values (
    auth.uid(), v_company,
    p_pickup_lat, p_pickup_lng, coalesce(p_pickup_address,''), coalesce(p_pickup_city,''),
    p_dropoff_lat, p_dropoff_lng, coalesce(p_dropoff_address,''), coalesce(p_dropoff_city,''),
    p_vehicle_type, greatest(coalesce(p_pallets,1),1), p_delivery_speed, coalesce(p_notes,''),
    (v_q->>'distanceKm')::numeric, (v_q->>'freightPrice')::numeric, (v_q->>'commissionAmount')::numeric,
    (v_q->>'bookingFee')::numeric, (v_q->>'platformEarnings')::numeric, (v_q->>'providerNet')::numeric,
    (v_q->>'totalPrice')::numeric, 'CAD', 'Open'
  ) returning id into v_id;

  perform public.write_audit('load.posted', 'loads', v_id::text, null,
    jsonb_build_object('vehicle', p_vehicle_type, 'pallets', p_pallets, 'total', (v_q->>'totalPrice')::numeric), '');
  return v_id;
end;
$$;
grant execute on function public.post_load(numeric, numeric, text, text, numeric, numeric, text, text, load_vehicle_type, int, text, text) to authenticated;

-- =========================================================================
-- 6) ACCEPT A LOAD — driver / trucking company claims an Open load.
-- Creates the invoice + payment + payout so the platform commission and
-- booking fee land in Finance immediately, mirroring record_payment.
-- =========================================================================
create or replace function public.accept_load(p_load_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_load public.loads;
  v_company uuid;
  v_invoice_id uuid;
  v_payment_id uuid;
  v_number text;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;

  select * into v_load from public.loads where id = p_load_id for update;
  if v_load is null then raise exception 'load not found'; end if;
  if v_load.status <> 'Open' then raise exception 'this load is no longer available'; end if;
  if v_load.poster_user_id = auth.uid() then raise exception 'you cannot accept your own load'; end if;

  select company_id into v_company from public.profiles where id = auth.uid();

  v_number := 'INV-LOAD-' || to_char(now(), 'YYYYMMDD') || '-' || substr(gen_random_uuid()::text, 1, 6);

  insert into public.invoices (
    customer_company_id, provider_company_id,
    invoice_number, subtotal_amount, tax_amount, total_amount,
    currency, status, issued_at
  ) values (
    v_load.poster_company_id, v_company,
    v_number, v_load.freight_price, 0, v_load.total_price,
    'CAD', 'Issued', now()
  ) returning id into v_invoice_id;

  insert into public.invoice_lines (invoice_id, description, quantity, unit_price, line_total, sort_order)
  values (v_invoice_id, v_load.vehicle_type || ' freight — ' || v_load.distance_km || ' km', 1, v_load.freight_price, v_load.freight_price, 0);
  insert into public.invoice_lines (invoice_id, description, quantity, unit_price, line_total, sort_order)
  values (v_invoice_id, 'Booking fee', 1, v_load.booking_fee, v_load.booking_fee, 1);

  insert into public.payments (
    invoice_id, customer_company_id, provider_company_id,
    gross_amount, commission_amount, net_amount, currency,
    status, payment_method, category, authorized_at, captured_at
  ) values (
    v_invoice_id, v_load.poster_company_id, v_company,
    v_load.total_price, v_load.platform_earnings, v_load.provider_net, 'CAD',
    'Captured', 'load', 'trucking', now(), now()
  ) returning id into v_payment_id;

  -- Payout to the carrier company (only when the acceptor belongs to a company).
  if v_company is not null then
    insert into public.payouts (company_id, payment_id, gross_amount, commission_amount, net_amount, currency, status)
    values (v_company, v_payment_id, v_load.total_price, v_load.platform_earnings, v_load.provider_net, 'CAD', 'Pending');
  end if;

  update public.loads set
    status = 'Accepted',
    accepted_driver_user_id = auth.uid(),
    accepted_company_id = v_company,
    accepted_at = now(),
    invoice_id = v_invoice_id,
    payment_id = v_payment_id,
    updated_at = now()
  where id = p_load_id;

  -- Notify the shipper their load was picked up.
  insert into public.notifications (user_id, kind, title, body, entity_type, entity_id)
  values (v_load.poster_user_id, 'system', 'Load accepted 🚚',
    'A driver accepted your ' || v_load.vehicle_type || ' load. Track it under Loads.',
    'loads', p_load_id);

  perform public.write_audit('load.accepted', 'loads', p_load_id::text, null,
    jsonb_build_object('driver', auth.uid(), 'company', v_company, 'platform_earnings', v_load.platform_earnings), '');
end;
$$;
grant execute on function public.accept_load(uuid) to authenticated;

-- =========================================================================
-- 7) ADVANCE A LOAD — accepted driver moves the trip forward / cancels
-- =========================================================================
create or replace function public.advance_load(p_load_id uuid, p_next_status load_status)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_load public.loads;
  v_ok boolean := false;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  select * into v_load from public.loads where id = p_load_id for update;
  if v_load is null then raise exception 'load not found'; end if;

  if not (v_load.accepted_driver_user_id = auth.uid()
          or (v_load.accepted_company_id is not null and public.is_member_of(v_load.accepted_company_id))
          or public.is_admin()) then
    raise exception 'not authorized for this load' using errcode = '42501';
  end if;

  v_ok := case
    when v_load.status = 'Accepted' and p_next_status = 'EnRoute'  then true
    when v_load.status = 'EnRoute'  and p_next_status = 'Arrived'  then true
    when v_load.status = 'Arrived'  and p_next_status = 'Delivered' then true
    when v_load.status in ('Accepted','EnRoute','Arrived') and p_next_status = 'Cancelled' then true
    else false
  end;
  if not v_ok then raise exception 'invalid load transition % -> %', v_load.status, p_next_status; end if;

  update public.loads set status = p_next_status, updated_at = now() where id = p_load_id;

  insert into public.notifications (user_id, kind, title, body, entity_type, entity_id)
  values (v_load.poster_user_id, 'system', 'Load update',
    'Your load is now: ' || p_next_status, 'loads', p_load_id);

  perform public.write_audit('load.' || lower(p_next_status::text), 'loads', p_load_id::text, null,
    jsonb_build_object('from', v_load.status, 'to', p_next_status), '');
end;
$$;
grant execute on function public.advance_load(uuid, load_status) to authenticated;
