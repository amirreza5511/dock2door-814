-- ---------------------------------------------------------------------------
-- 0137 — Freight hubs, warehouse legs, itemised pricing & payer choice.
-- ---------------------------------------------------------------------------
-- Next-day (and longer) deliveries can now route through the nearest partner
-- warehouse hub: pickup -> hub (storage) -> final drop-off. We add:
--   1) Hub + leg-tracking columns and hub handling/storage fee columns on loads.
--   2) Handling + per-pallet-per-day storage rates on load_rate_cards.
--   3) find_nearest_hub(lat,lng) — nearest Active warehouse listing with geo.
--   4) quote_load — now itemises transport + handling + storage, honoring who
--      pays (shipper upfront vs. receiver on release) and whether a hub is used.
--   5) post_load — resolves the hub, stores fees + payer, and links the hub.
--   6) hub_confirm_inbound / hub_release_load RPCs for the warehouse hub side.
-- Additive & idempotent. Existing callers keep working (new params default).

-- =========================================================================
-- 1) LOADS — hub + leg + fee columns
-- =========================================================================
alter table public.loads add column if not exists uses_hub boolean not null default false;
alter table public.loads add column if not exists hub_listing_id uuid references public.warehouse_listings(id) on delete set null;
alter table public.loads add column if not exists hub_company_id uuid references public.companies(id) on delete set null;
alter table public.loads add column if not exists hub_name text not null default '';
alter table public.loads add column if not exists hub_leg_status text not null default 'None' check (hub_leg_status in ('None','Pending','AtHub','Released'));
alter table public.loads add column if not exists hub_arrived_at timestamptz;
alter table public.loads add column if not exists hub_departed_at timestamptz;
alter table public.loads add column if not exists handling_fee numeric not null default 0;
alter table public.loads add column if not exists storage_per_day numeric not null default 0;
alter table public.loads add column if not exists storage_payer text not null default 'shipper' check (storage_payer in ('shipper','receiver'));
alter table public.loads add column if not exists storage_days int not null default 0;
alter table public.loads add column if not exists storage_charged numeric not null default 0;

create index if not exists idx_loads_hub_company on public.loads(hub_company_id);
create index if not exists idx_loads_hub_leg on public.loads(hub_leg_status);

-- =========================================================================
-- 2) RATE CARDS — handling + per-pallet-per-day storage
-- =========================================================================
alter table public.load_rate_cards add column if not exists handling_fee_per_pallet numeric not null default 5;
alter table public.load_rate_cards add column if not exists storage_fee_per_pallet_day numeric not null default 2;

-- =========================================================================
-- 3) NEAREST HUB — closest Active warehouse listing with geo coordinates
-- =========================================================================
create or replace function public.find_nearest_hub(p_lat numeric, p_lng numeric)
returns table(id uuid, company_id uuid, name text, geo_lat numeric, geo_lng numeric, distance_km numeric)
language sql stable set search_path = public as $$
  select w.id, w.company_id, w.name, w.geo_lat, w.geo_lng,
         public.load_distance_km(p_lat, p_lng, w.geo_lat, w.geo_lng) as distance_km
  from public.warehouse_listings w
  where w.geo_lat is not null and w.geo_lng is not null
    and w.status::text in ('Active','Published','Available','Approved')
  order by public.load_distance_km(p_lat, p_lng, w.geo_lat, w.geo_lng) asc
  limit 1;
$$;
grant execute on function public.find_nearest_hub(numeric, numeric) to authenticated;

-- =========================================================================
-- 4) QUOTE_LOAD — itemised, hub-aware, payer-aware
-- =========================================================================
create or replace function public.quote_load(
  p_pickup_lat numeric, p_pickup_lng numeric,
  p_dropoff_lat numeric, p_dropoff_lng numeric,
  p_vehicle_type load_vehicle_type,
  p_pallets int,
  p_delivery_speed text,
  p_cargo_type load_cargo_type default 'Pallet',
  p_weight_kg numeric default 0,
  p_distance_km numeric default null,
  p_storage_payer text default 'shipper'
) returns jsonb language plpgsql stable set search_path = public as $$
declare
  v_distance numeric;
  v_base numeric;
  v_per_km numeric;
  v_per_pallet numeric;
  v_speed_mult numeric;
  v_handling_per_pallet numeric;
  v_storage_per_pallet_day numeric;
  v_weight_fee numeric;
  v_freight numeric;
  v_company uuid;
  v_commission_pct numeric := 12;
  v_booking_fee numeric := 5;
  v_commission numeric;
  v_platform numeric;
  v_pallets int;
  v_uses_hub boolean := false;
  v_hub_id uuid;
  v_hub_name text := '';
  v_handling numeric := 0;
  v_storage_per_day numeric := 0;
  v_est_days int := 1;
  v_est_storage numeric := 0;
  v_hub_cost_shipper numeric := 0;
  v_payer text;
begin
  v_payer := case when p_storage_payer = 'receiver' then 'receiver' else 'shipper' end;
  v_pallets := greatest(coalesce(p_pallets, 0), 0);

  if p_distance_km is not null and p_distance_km > 0 then
    v_distance := round(p_distance_km::numeric, 2);
  else
    v_distance := public.load_distance_km(p_pickup_lat, p_pickup_lng, p_dropoff_lat, p_dropoff_lng);
  end if;

  select company_id into v_company from public.profiles where id = auth.uid();

  select rc.base_price, rc.per_km, rc.per_pallet,
         case when p_delivery_speed = 'SameDay' then rc.same_day_multiplier else 1.0 end,
         rc.handling_fee_per_pallet, rc.storage_fee_per_pallet_day
    into v_base, v_per_km, v_per_pallet, v_speed_mult, v_handling_per_pallet, v_storage_per_pallet_day
    from public.load_rate_cards rc
    where rc.vehicle_type = p_vehicle_type
      and (rc.company_id = v_company or rc.company_id is null)
    order by (rc.company_id is not null) desc
    limit 1;

  if v_base is null then
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

  v_handling_per_pallet := coalesce(v_handling_per_pallet, 5);
  v_storage_per_pallet_day := coalesce(v_storage_per_pallet_day, 2);

  v_weight_fee := round(greatest(coalesce(p_weight_kg, 0) - 50, 0) * 0.05, 2);
  v_freight := round((v_base + v_per_km * v_distance + v_per_pallet * v_pallets + v_weight_fee) * v_speed_mult, 2);

  -- Non same-day deliveries route through the nearest partner hub (if one exists).
  if p_delivery_speed <> 'SameDay' then
    select h.id, h.name into v_hub_id, v_hub_name
      from public.find_nearest_hub(p_pickup_lat, p_pickup_lng) h;
    if v_hub_id is not null then
      v_uses_hub := true;
      v_handling := round(v_handling_per_pallet * greatest(v_pallets, 1), 2);
      v_storage_per_day := round(v_storage_per_pallet_day * greatest(v_pallets, 1), 2);
      v_est_storage := round(v_storage_per_day * v_est_days, 2);
    end if;
  end if;

  -- Shipper only pays hub costs upfront when they chose to cover storage.
  if v_uses_hub and v_payer = 'shipper' then
    v_hub_cost_shipper := round(v_handling + v_est_storage, 2);
  end if;

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
    'usesHub', v_uses_hub,
    'hubName', v_hub_name,
    'handlingFee', v_handling,
    'storagePerDay', v_storage_per_day,
    'estStorageDays', v_est_days,
    'estStorageFee', v_est_storage,
    'storagePayer', v_payer,
    'hubCostToShipper', v_hub_cost_shipper,
    'totalPrice', round(v_freight + v_booking_fee + v_hub_cost_shipper, 2),
    'currency', 'CAD'
  );
end;
$$;
grant execute on function public.quote_load(numeric, numeric, numeric, numeric, load_vehicle_type, int, text, load_cargo_type, numeric, numeric, text) to authenticated;

-- =========================================================================
-- 5) POST_LOAD — resolves hub, stores fees + payer
-- =========================================================================
create or replace function public.post_load(
  p_pickup_lat numeric, p_pickup_lng numeric, p_pickup_address text, p_pickup_city text,
  p_dropoff_lat numeric, p_dropoff_lng numeric, p_dropoff_address text, p_dropoff_city text,
  p_vehicle_type load_vehicle_type,
  p_pallets int,
  p_delivery_speed text,
  p_notes text,
  p_cargo_type load_cargo_type default 'Pallet',
  p_item_count int default 1,
  p_weight_kg numeric default 0,
  p_length_cm numeric default 0,
  p_width_cm numeric default 0,
  p_height_cm numeric default 0,
  p_item_description text default '',
  p_recipient_name text default '',
  p_recipient_phone text default '',
  p_distance_km numeric default null,
  p_storage_payer text default 'shipper'
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_q jsonb;
  v_company uuid;
  v_id uuid;
  v_uses_hub boolean;
  v_hub_id uuid;
  v_hub_company uuid;
  v_hub_name text := '';
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  if p_delivery_speed not in ('SameDay','NextDay') then raise exception 'invalid delivery speed'; end if;

  v_q := public.quote_load(
    p_pickup_lat, p_pickup_lng, p_dropoff_lat, p_dropoff_lng,
    p_vehicle_type, p_pallets, p_delivery_speed, p_cargo_type, p_weight_kg, p_distance_km, p_storage_payer);
  select company_id into v_company from public.profiles where id = auth.uid();

  v_uses_hub := coalesce((v_q->>'usesHub')::boolean, false);
  if v_uses_hub then
    select h.id, h.company_id, h.name into v_hub_id, v_hub_company, v_hub_name
      from public.find_nearest_hub(p_pickup_lat, p_pickup_lng) h;
  end if;

  insert into public.loads (
    poster_user_id, poster_company_id,
    pickup_lat, pickup_lng, pickup_address, pickup_city,
    dropoff_lat, dropoff_lng, dropoff_address, dropoff_city,
    vehicle_type, pallets, delivery_speed, notes,
    cargo_type, item_count, weight_kg, length_cm, width_cm, height_cm,
    item_description, recipient_name, recipient_phone,
    distance_km, freight_price, commission_amount, booking_fee,
    platform_earnings, provider_net, total_price, currency, status,
    uses_hub, hub_listing_id, hub_company_id, hub_name, hub_leg_status,
    handling_fee, storage_per_day, storage_payer
  ) values (
    auth.uid(), v_company,
    p_pickup_lat, p_pickup_lng, coalesce(p_pickup_address,''), coalesce(p_pickup_city,''),
    p_dropoff_lat, p_dropoff_lng, coalesce(p_dropoff_address,''), coalesce(p_dropoff_city,''),
    p_vehicle_type, greatest(coalesce(p_pallets,1),1), p_delivery_speed, coalesce(p_notes,''),
    coalesce(p_cargo_type,'Pallet'), greatest(coalesce(p_item_count,1),1), greatest(coalesce(p_weight_kg,0),0),
    greatest(coalesce(p_length_cm,0),0), greatest(coalesce(p_width_cm,0),0), greatest(coalesce(p_height_cm,0),0),
    coalesce(p_item_description,''), coalesce(p_recipient_name,''), coalesce(p_recipient_phone,''),
    (v_q->>'distanceKm')::numeric, (v_q->>'freightPrice')::numeric, (v_q->>'commissionAmount')::numeric,
    (v_q->>'bookingFee')::numeric, (v_q->>'platformEarnings')::numeric, (v_q->>'providerNet')::numeric,
    (v_q->>'totalPrice')::numeric, 'CAD', 'Open',
    v_uses_hub, v_hub_id, v_hub_company, coalesce(v_hub_name,''),
    case when v_uses_hub then 'Pending' else 'None' end,
    (v_q->>'handlingFee')::numeric, (v_q->>'storagePerDay')::numeric,
    case when (v_q->>'storagePayer') = 'receiver' then 'receiver' else 'shipper' end
  ) returning id into v_id;

  perform public.write_audit('load.posted', 'loads', v_id::text, null,
    jsonb_build_object('vehicle', p_vehicle_type, 'cargo', p_cargo_type, 'pallets', p_pallets,
      'total', (v_q->>'totalPrice')::numeric, 'usesHub', v_uses_hub, 'hub', v_hub_name), '');
  return v_id;
end;
$$;
grant execute on function public.post_load(numeric, numeric, text, text, numeric, numeric, text, text, load_vehicle_type, int, text, text, load_cargo_type, int, numeric, numeric, numeric, numeric, text, text, text, numeric, text) to authenticated;

-- =========================================================================
-- 6) HUB SIDE — confirm inbound & release outbound (bills storage)
-- =========================================================================
-- Warehouse confirms the freight has physically arrived at the hub.
create or replace function public.hub_confirm_inbound(p_load_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_load public.loads;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  select * into v_load from public.loads where id = p_load_id for update;
  if v_load is null then raise exception 'load not found'; end if;
  if not (public.is_admin() or (v_load.hub_company_id is not null and public.is_member_of(v_load.hub_company_id))) then
    raise exception 'not authorized for this hub load' using errcode = '42501';
  end if;
  if not v_load.uses_hub then raise exception 'this load does not route through a hub'; end if;

  update public.loads
     set hub_leg_status = 'AtHub', hub_arrived_at = now(), updated_at = now()
   where id = p_load_id;

  insert into public.notifications (user_id, kind, title, body, entity_type, entity_id)
  values (v_load.poster_user_id, 'system', 'Arrived at hub 🏬',
    'Your goods arrived at ' || coalesce(nullif(v_load.hub_name,''), 'the hub') || ' and are in storage.',
    'loads', p_load_id);

  perform public.write_audit('load.hub_inbound', 'loads', p_load_id::text, null,
    jsonb_build_object('hub', v_load.hub_company_id), '');
end;
$$;
grant execute on function public.hub_confirm_inbound(uuid) to authenticated;

-- Warehouse releases the freight for final delivery; bills accrued storage.
create or replace function public.hub_release_load(p_load_id uuid)
returns numeric language plpgsql security definer set search_path = public as $$
declare
  v_load public.loads;
  v_days int;
  v_charge numeric;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  select * into v_load from public.loads where id = p_load_id for update;
  if v_load is null then raise exception 'load not found'; end if;
  if not (public.is_admin() or (v_load.hub_company_id is not null and public.is_member_of(v_load.hub_company_id))) then
    raise exception 'not authorized for this hub load' using errcode = '42501';
  end if;
  if v_load.hub_leg_status <> 'AtHub' then raise exception 'load is not currently at the hub'; end if;

  v_days := greatest(1, ceil(extract(epoch from (now() - coalesce(v_load.hub_arrived_at, now()))) / 86400.0)::int);
  v_charge := round(coalesce(v_load.storage_per_day, 0) * v_days, 2);

  update public.loads
     set hub_leg_status = 'Released', hub_departed_at = now(),
         storage_days = v_days, storage_charged = v_charge, updated_at = now()
   where id = p_load_id;

  insert into public.notifications (user_id, kind, title, body, entity_type, entity_id)
  values (v_load.poster_user_id, 'system', 'Released for delivery 🚚',
    'Your goods left ' || coalesce(nullif(v_load.hub_name,''), 'the hub') || ' for final delivery. Storage: '
      || v_days || ' day(s), $' || v_charge || ' ('
      || case when v_load.storage_payer = 'receiver' then 'billed to receiver' else 'billed to you' end || ').',
    'loads', p_load_id);

  perform public.write_audit('load.hub_released', 'loads', p_load_id::text, null,
    jsonb_build_object('days', v_days, 'charge', v_charge, 'payer', v_load.storage_payer), '');
  return v_charge;
end;
$$;
grant execute on function public.hub_release_load(uuid) to authenticated;

-- =========================================================================
-- 7) ADMIN RATE CARD — now sets handling + storage rates too
-- =========================================================================
create or replace function public.admin_upsert_rate_card(
  p_company_id uuid,
  p_vehicle_type load_vehicle_type,
  p_base_price numeric,
  p_per_km numeric,
  p_per_pallet numeric,
  p_same_day_multiplier numeric,
  p_handling_fee_per_pallet numeric default 5,
  p_storage_fee_per_pallet_day numeric default 2
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  perform public.require_admin();

  if p_company_id is null then
    update public.load_rate_cards set
      base_price = p_base_price, per_km = p_per_km, per_pallet = p_per_pallet,
      same_day_multiplier = p_same_day_multiplier,
      handling_fee_per_pallet = p_handling_fee_per_pallet,
      storage_fee_per_pallet_day = p_storage_fee_per_pallet_day, updated_at = now()
    where company_id is null and vehicle_type = p_vehicle_type
    returning id into v_id;
    if v_id is null then
      insert into public.load_rate_cards (company_id, vehicle_type, base_price, per_km, per_pallet, same_day_multiplier, handling_fee_per_pallet, storage_fee_per_pallet_day)
      values (null, p_vehicle_type, p_base_price, p_per_km, p_per_pallet, p_same_day_multiplier, p_handling_fee_per_pallet, p_storage_fee_per_pallet_day)
      returning id into v_id;
    end if;
  else
    insert into public.load_rate_cards (company_id, vehicle_type, base_price, per_km, per_pallet, same_day_multiplier, handling_fee_per_pallet, storage_fee_per_pallet_day)
    values (p_company_id, p_vehicle_type, p_base_price, p_per_km, p_per_pallet, p_same_day_multiplier, p_handling_fee_per_pallet, p_storage_fee_per_pallet_day)
    on conflict (company_id, vehicle_type) do update set
      base_price = excluded.base_price, per_km = excluded.per_km, per_pallet = excluded.per_pallet,
      same_day_multiplier = excluded.same_day_multiplier,
      handling_fee_per_pallet = excluded.handling_fee_per_pallet,
      storage_fee_per_pallet_day = excluded.storage_fee_per_pallet_day, updated_at = now()
    returning id into v_id;
  end if;

  perform public.write_audit('rate_card.upsert', 'load_rate_cards', v_id::text, null,
    jsonb_build_object('company', p_company_id, 'vehicle', p_vehicle_type, 'base', p_base_price, 'handling', p_handling_fee_per_pallet, 'storage', p_storage_fee_per_pallet_day), '');
  return v_id;
end;
$$;
grant execute on function public.admin_upsert_rate_card(uuid, load_vehicle_type, numeric, numeric, numeric, numeric, numeric, numeric) to authenticated;
