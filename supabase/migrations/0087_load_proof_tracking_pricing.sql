-- Dock2Door — Proof of pickup/delivery, live truck tracking, and admin pricing.
-- Idempotent. Adds:
--   1) Proof fields on loads (pickup/delivery photos, receiver name, timestamps).
--   2) Live driver location fields on loads + an update_driver_location RPC.
--   3) A rate-card store (global defaults + per-company overrides) and per-company
--      commission overrides, plus admin RPCs to manage them.
--   4) quote_load now reads the effective rate card / commission for the poster's
--      company (override -> global -> built-in fallback).
--   5) advance_load now enforces the photo requirements and records proof.

-- =========================================================================
-- 1) PROOF + LIVE LOCATION COLUMNS ON LOADS
-- =========================================================================
alter table public.loads add column if not exists pickup_photo_path text;
alter table public.loads add column if not exists delivery_photo_path text;
alter table public.loads add column if not exists receiver_name text not null default '';
alter table public.loads add column if not exists picked_up_at timestamptz;
alter table public.loads add column if not exists delivered_at timestamptz;
alter table public.loads add column if not exists driver_lat numeric;
alter table public.loads add column if not exists driver_lng numeric;
alter table public.loads add column if not exists driver_location_at timestamptz;

-- =========================================================================
-- 2) RATE CARDS — global defaults (company_id IS NULL) + per-company overrides
-- =========================================================================
create table if not exists public.load_rate_cards (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  vehicle_type load_vehicle_type not null,
  base_price numeric not null default 0,
  per_km numeric not null default 0,
  per_pallet numeric not null default 8,
  same_day_multiplier numeric not null default 1.4,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One global row per vehicle type, and one override row per (company, vehicle type).
create unique index if not exists uniq_rate_card_global
  on public.load_rate_cards (vehicle_type) where company_id is null;
create unique index if not exists uniq_rate_card_company
  on public.load_rate_cards (company_id, vehicle_type) where company_id is not null;

alter table public.load_rate_cards enable row level security;
drop policy if exists "rate_cards_read" on public.load_rate_cards;
create policy "rate_cards_read" on public.load_rate_cards for select using (public.is_authenticated());
drop policy if exists "rate_cards_admin" on public.load_rate_cards;
create policy "rate_cards_admin" on public.load_rate_cards for all using (public.is_admin()) with check (public.is_admin());

-- Per-company commission override. No row => use platform_settings global values.
create table if not exists public.load_commission_overrides (
  company_id uuid primary key references public.companies(id) on delete cascade,
  commission_percentage numeric not null default 12,
  booking_fee numeric not null default 5,
  updated_at timestamptz not null default now()
);
alter table public.load_commission_overrides enable row level security;
drop policy if exists "commission_overrides_read" on public.load_commission_overrides;
create policy "commission_overrides_read" on public.load_commission_overrides for select using (public.is_authenticated());
drop policy if exists "commission_overrides_admin" on public.load_commission_overrides;
create policy "commission_overrides_admin" on public.load_commission_overrides for all using (public.is_admin()) with check (public.is_admin());

-- Seed the global rate cards from the previously hardcoded values (no-op if present).
insert into public.load_rate_cards (company_id, vehicle_type, base_price, per_km, per_pallet, same_day_multiplier)
values
  (null, 'Bicycle',      6,   1.2, 8, 1.4),
  (null, 'Motorcycle',   8,   1.5, 8, 1.4),
  (null, 'Car',          12,  1.8, 8, 1.4),
  (null, 'Pickup',       25,  2.2, 8, 1.4),
  (null, 'MovingTruck',  60,  3.0, 8, 1.4),
  (null, 'FiveTon',      90,  3.5, 8, 1.4),
  (null, 'FlatDeck',     120, 4.0, 8, 1.4),
  (null, 'Semi',         200, 4.5, 8, 1.4)
on conflict do nothing;

-- =========================================================================
-- 3) ADMIN RPCs — manage rate cards + commission overrides (audited)
-- =========================================================================
create or replace function public.admin_upsert_rate_card(
  p_company_id uuid,
  p_vehicle_type load_vehicle_type,
  p_base_price numeric,
  p_per_km numeric,
  p_per_pallet numeric,
  p_same_day_multiplier numeric
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  perform public.require_admin();

  if p_company_id is null then
    update public.load_rate_cards set
      base_price = p_base_price, per_km = p_per_km, per_pallet = p_per_pallet,
      same_day_multiplier = p_same_day_multiplier, updated_at = now()
    where company_id is null and vehicle_type = p_vehicle_type
    returning id into v_id;
    if v_id is null then
      insert into public.load_rate_cards (company_id, vehicle_type, base_price, per_km, per_pallet, same_day_multiplier)
      values (null, p_vehicle_type, p_base_price, p_per_km, p_per_pallet, p_same_day_multiplier)
      returning id into v_id;
    end if;
  else
    insert into public.load_rate_cards (company_id, vehicle_type, base_price, per_km, per_pallet, same_day_multiplier)
    values (p_company_id, p_vehicle_type, p_base_price, p_per_km, p_per_pallet, p_same_day_multiplier)
    on conflict (company_id, vehicle_type) do update set
      base_price = excluded.base_price, per_km = excluded.per_km, per_pallet = excluded.per_pallet,
      same_day_multiplier = excluded.same_day_multiplier, updated_at = now()
    returning id into v_id;
  end if;

  perform public.write_audit('rate_card.upsert', 'load_rate_cards', v_id::text, null,
    jsonb_build_object('company', p_company_id, 'vehicle', p_vehicle_type, 'base', p_base_price, 'perKm', p_per_km), '');
  return v_id;
end;
$$;
grant execute on function public.admin_upsert_rate_card(uuid, load_vehicle_type, numeric, numeric, numeric, numeric) to authenticated;

create or replace function public.admin_delete_rate_card(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_admin();
  -- Never allow deleting a global rate card; only company overrides.
  delete from public.load_rate_cards where id = p_id and company_id is not null;
  perform public.write_audit('rate_card.delete', 'load_rate_cards', p_id::text, null, null, '');
end;
$$;
grant execute on function public.admin_delete_rate_card(uuid) to authenticated;

create or replace function public.admin_upsert_commission_override(
  p_company_id uuid,
  p_commission_percentage numeric,
  p_booking_fee numeric
) returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_admin();
  if p_company_id is null then raise exception 'a company is required'; end if;
  insert into public.load_commission_overrides (company_id, commission_percentage, booking_fee)
  values (p_company_id, p_commission_percentage, p_booking_fee)
  on conflict (company_id) do update set
    commission_percentage = excluded.commission_percentage,
    booking_fee = excluded.booking_fee, updated_at = now();
  perform public.write_audit('commission_override.upsert', 'load_commission_overrides', p_company_id::text, null,
    jsonb_build_object('pct', p_commission_percentage, 'fee', p_booking_fee), '');
end;
$$;
grant execute on function public.admin_upsert_commission_override(uuid, numeric, numeric) to authenticated;

create or replace function public.admin_delete_commission_override(p_company_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_admin();
  delete from public.load_commission_overrides where company_id = p_company_id;
  perform public.write_audit('commission_override.delete', 'load_commission_overrides', p_company_id::text, null, null, '');
end;
$$;
grant execute on function public.admin_delete_commission_override(uuid) to authenticated;

-- =========================================================================
-- 4) QUOTE — read the effective rate card + commission for the poster's company
-- =========================================================================
drop function if exists public.quote_load(numeric, numeric, numeric, numeric, load_vehicle_type, int, text, load_cargo_type, numeric);

create or replace function public.quote_load(
  p_pickup_lat numeric, p_pickup_lng numeric,
  p_dropoff_lat numeric, p_dropoff_lng numeric,
  p_vehicle_type load_vehicle_type,
  p_pallets int,
  p_delivery_speed text,
  p_cargo_type load_cargo_type default 'Pallet',
  p_weight_kg numeric default 0
) returns jsonb language plpgsql stable set search_path = public as $$
declare
  v_distance numeric;
  v_base numeric;
  v_per_km numeric;
  v_per_pallet numeric;
  v_speed_mult numeric;
  v_weight_fee numeric;
  v_freight numeric;
  v_company uuid;
  v_commission_pct numeric := 12;
  v_booking_fee numeric := 5;
  v_commission numeric;
  v_platform numeric;
begin
  v_distance := public.load_distance_km(p_pickup_lat, p_pickup_lng, p_dropoff_lat, p_dropoff_lng);

  select company_id into v_company from public.profiles where id = auth.uid();

  -- Effective rate card: company override -> global -> built-in fallback.
  select rc.base_price, rc.per_km, rc.per_pallet,
         case when p_delivery_speed = 'SameDay' then rc.same_day_multiplier else 1.0 end
    into v_base, v_per_km, v_per_pallet, v_speed_mult
    from public.load_rate_cards rc
    where rc.vehicle_type = p_vehicle_type
      and (rc.company_id = v_company or rc.company_id is null)
    order by (rc.company_id is not null) desc
    limit 1;

  if v_base is null then
    -- Built-in fallback (rate cards not seeded yet).
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
    v_per_pallet := 8;
    v_speed_mult := case when p_delivery_speed = 'SameDay' then 1.4 else 1.0 end;
  end if;

  -- Heavy cargo surcharge: $0.05/kg over 50kg (keeps small parcels cheap).
  v_weight_fee := round(greatest(coalesce(p_weight_kg, 0) - 50, 0) * 0.05, 2);

  v_freight := round((v_base + v_per_km * v_distance + v_per_pallet * greatest(coalesce(p_pallets, 0), 0) + v_weight_fee) * v_speed_mult, 2);

  -- Effective commission: company override -> platform_settings.
  select co.commission_percentage, co.booking_fee
    into v_commission_pct, v_booking_fee
    from public.load_commission_overrides co
    where co.company_id = v_company;

  if v_commission_pct is null then
    select coalesce(trucking_commission_percentage, 12), coalesce(trucking_booking_fee, 5)
      into v_commission_pct, v_booking_fee
      from public.platform_settings limit 1;
  end if;

  v_commission_pct := coalesce(v_commission_pct, 12);
  v_booking_fee := coalesce(v_booking_fee, 5);
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
grant execute on function public.quote_load(numeric, numeric, numeric, numeric, load_vehicle_type, int, text, load_cargo_type, numeric) to authenticated;

-- =========================================================================
-- 5) ADVANCE A LOAD — enforce proof of pickup/delivery + record it.
-- =========================================================================
drop function if exists public.advance_load(uuid, load_status);

create or replace function public.advance_load(
  p_load_id uuid,
  p_next_status load_status,
  p_proof_photo_path text default null,
  p_receiver_name text default null
) returns void language plpgsql security definer set search_path = public as $$
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

  -- Proof gates: a pickup photo is required to go EnRoute; a delivery photo +
  -- receiver name are required to mark Delivered.
  if p_next_status = 'EnRoute' then
    if coalesce(p_proof_photo_path, '') = '' then
      raise exception 'a pickup photo is required before starting the trip';
    end if;
    update public.loads set
      status = p_next_status,
      pickup_photo_path = p_proof_photo_path,
      picked_up_at = now(),
      updated_at = now()
    where id = p_load_id;
  elsif p_next_status = 'Delivered' then
    if coalesce(p_proof_photo_path, '') = '' then
      raise exception 'a delivery photo is required to mark this delivered';
    end if;
    if coalesce(p_receiver_name, '') = '' then
      raise exception 'the receiver name is required to mark this delivered';
    end if;
    update public.loads set
      status = p_next_status,
      delivery_photo_path = p_proof_photo_path,
      receiver_name = p_receiver_name,
      delivered_at = now(),
      updated_at = now()
    where id = p_load_id;
  else
    update public.loads set status = p_next_status, updated_at = now() where id = p_load_id;
  end if;

  insert into public.notifications (user_id, kind, title, body, entity_type, entity_id)
  values (v_load.poster_user_id, 'system', 'Load update',
    'Your load is now: ' || p_next_status, 'loads', p_load_id);

  perform public.write_audit('load.' || lower(p_next_status::text), 'loads', p_load_id::text, null,
    jsonb_build_object('from', v_load.status, 'to', p_next_status), '');
end;
$$;
grant execute on function public.advance_load(uuid, load_status, text, text) to authenticated;

-- =========================================================================
-- 6) LIVE DRIVER LOCATION — driver pushes their GPS fix onto the active load.
-- =========================================================================
create or replace function public.update_driver_location(
  p_load_id uuid, p_lat numeric, p_lng numeric
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_load public.loads;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  select * into v_load from public.loads where id = p_load_id;
  if v_load is null then raise exception 'load not found'; end if;

  if not (v_load.accepted_driver_user_id = auth.uid()
          or (v_load.accepted_company_id is not null and public.is_member_of(v_load.accepted_company_id))) then
    raise exception 'not authorized for this load' using errcode = '42501';
  end if;

  if v_load.status not in ('Accepted','EnRoute','Arrived') then
    return; -- silently ignore stale updates after delivery/cancel
  end if;

  update public.loads set
    driver_lat = p_lat, driver_lng = p_lng, driver_location_at = now(), updated_at = now()
  where id = p_load_id;
end;
$$;
grant execute on function public.update_driver_location(uuid, numeric, numeric) to authenticated;
