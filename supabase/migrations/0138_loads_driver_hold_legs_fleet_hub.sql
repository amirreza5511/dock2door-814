-- ---------------------------------------------------------------------------
-- 0138 — Driver truck-hold, two-leg dispatch (pickup / delivery) & fleet hubs.
-- ---------------------------------------------------------------------------
-- Builds on 0137 (freight hubs). Adds:
--   1) Driver "hold in my truck" option: instead of routing a next-day load
--      through a warehouse hub, the accepting driver may keep it overnight and
--      earn the handling + storage fee themselves.
--   2) Two legs on hub loads — a pickup leg (pickup -> hub) and a delivery leg
--      (hub -> drop-off) — each independently assignable/claimable by a driver.
--   3) An "open jobs" board: drivers self-claim a pickup or delivery leg near
--      their zone; dispatchers can also assign legs manually.
--   4) Fleets that own a warehouse can flag it as a network hub (or keep it
--      internal only). find_nearest_hub honours the flag.
-- Additive & idempotent.

-- =========================================================================
-- 1) LOADS — driver-hold + leg columns
-- =========================================================================
alter table public.loads add column if not exists driver_hold boolean not null default false;
alter table public.loads add column if not exists driver_hold_fee numeric not null default 0;
alter table public.loads add column if not exists pickup_leg_driver_user_id uuid references public.profiles(id) on delete set null;
alter table public.loads add column if not exists delivery_leg_driver_user_id uuid references public.profiles(id) on delete set null;
alter table public.loads add column if not exists pickup_leg_status text not null default 'None' check (pickup_leg_status in ('None','Open','Claimed','Completed'));
alter table public.loads add column if not exists delivery_leg_status text not null default 'None' check (delivery_leg_status in ('None','Open','Claimed','Completed'));

create index if not exists idx_loads_pickup_leg_driver on public.loads(pickup_leg_driver_user_id);
create index if not exists idx_loads_delivery_leg_driver on public.loads(delivery_leg_driver_user_id);

-- Backfill leg status for existing hub loads: hub loads become two open legs.
update public.loads
   set pickup_leg_status = case when hub_leg_status in ('Pending') then 'Open' when hub_leg_status in ('AtHub','Released') then 'Completed' else pickup_leg_status end,
       delivery_leg_status = case when hub_leg_status = 'Released' then 'Open' else delivery_leg_status end
 where uses_hub = true and pickup_leg_status = 'None';

-- =========================================================================
-- 2) WAREHOUSE LISTINGS — network-hub opt-in flag (default true = discoverable)
-- =========================================================================
alter table public.warehouse_listings add column if not exists is_network_hub boolean not null default true;

-- Rebuild find_nearest_hub so only listings opted into the network are matched.
create or replace function public.find_nearest_hub(p_lat numeric, p_lng numeric)
returns table(id uuid, company_id uuid, name text, geo_lat numeric, geo_lng numeric, distance_km numeric)
language sql stable set search_path = public as $$
  select w.id, w.company_id, w.name, w.geo_lat, w.geo_lng,
         public.load_distance_km(p_lat, p_lng, w.geo_lat, w.geo_lng) as distance_km
  from public.warehouse_listings w
  where w.geo_lat is not null and w.geo_lng is not null
    and coalesce(w.is_network_hub, true) = true
    and w.status::text in ('Active','Published','Available','Approved')
  order by public.load_distance_km(p_lat, p_lng, w.geo_lat, w.geo_lng) asc
  limit 1;
$$;
grant execute on function public.find_nearest_hub(numeric, numeric) to authenticated;

-- Fleet toggles whether their own warehouse listing is a network hub.
create or replace function public.set_warehouse_hub(p_listing_id uuid, p_enabled boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_listing public.warehouse_listings;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  select * into v_listing from public.warehouse_listings where id = p_listing_id;
  if v_listing is null then raise exception 'listing not found'; end if;
  if not (public.is_admin() or (v_listing.company_id is not null and public.is_member_of(v_listing.company_id))) then
    raise exception 'not authorized for this listing' using errcode = '42501';
  end if;
  update public.warehouse_listings set is_network_hub = coalesce(p_enabled, true), updated_at = now()
   where id = p_listing_id;
  perform public.write_audit('warehouse.hub_toggle', 'warehouse_listings', p_listing_id::text, null,
    jsonb_build_object('enabled', p_enabled), '');
end;
$$;
grant execute on function public.set_warehouse_hub(uuid, boolean) to authenticated;

-- =========================================================================
-- 3) POST_LOAD — initialise the pickup leg as Open for hub loads
-- =========================================================================
-- We only extend the tail of the existing behaviour: after a hub load is
-- created it now also opens the pickup leg so drivers can claim it.
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
    handling_fee, storage_per_day, storage_payer,
    pickup_leg_status, delivery_leg_status
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
    case when (v_q->>'storagePayer') = 'receiver' then 'receiver' else 'shipper' end,
    case when v_uses_hub then 'Open' else 'None' end,
    'None'
  ) returning id into v_id;

  perform public.write_audit('load.posted', 'loads', v_id::text, null,
    jsonb_build_object('vehicle', p_vehicle_type, 'cargo', p_cargo_type, 'pallets', p_pallets,
      'total', (v_q->>'totalPrice')::numeric, 'usesHub', v_uses_hub, 'hub', v_hub_name), '');
  return v_id;
end;
$$;
grant execute on function public.post_load(numeric, numeric, text, text, numeric, numeric, text, text, load_vehicle_type, int, text, text, load_cargo_type, int, numeric, numeric, numeric, numeric, text, text, text, numeric, text) to authenticated;

-- =========================================================================
-- 4) DRIVER HOLD — keep the load in the truck instead of the hub
-- =========================================================================
-- The accepting driver (pickup-leg runner) can opt to hold a hub-routed load
-- overnight in their own truck. This bypasses the hub: the handling + one day
-- of storage is redirected from the warehouse to the driver's payout.
create or replace function public.driver_hold_load(p_load_id uuid, p_hold boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_load public.loads;
  v_fee numeric;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  select * into v_load from public.loads where id = p_load_id for update;
  if v_load is null then raise exception 'load not found'; end if;

  if not (public.is_admin()
          or v_load.accepted_driver_user_id = auth.uid()
          or v_load.pickup_leg_driver_user_id = auth.uid()
          or (v_load.accepted_company_id is not null and public.is_member_of(v_load.accepted_company_id))) then
    raise exception 'not authorized for this load' using errcode = '42501';
  end if;
  if not v_load.uses_hub then raise exception 'this load does not route through a hub'; end if;
  if v_load.hub_leg_status = 'AtHub' then raise exception 'the goods are already at the hub'; end if;
  if v_load.status = 'Delivered' then raise exception 'load already delivered'; end if;

  if coalesce(p_hold, true) then
    -- Redirect hub fees to the driver; skip both hub legs.
    v_fee := round(coalesce(v_load.handling_fee, 0) + coalesce(v_load.storage_per_day, 0), 2);
    update public.loads set
      driver_hold = true,
      driver_hold_fee = v_fee,
      provider_net = round(coalesce(provider_net, 0) + v_fee, 2),
      hub_leg_status = 'None',
      pickup_leg_status = 'None',
      delivery_leg_status = 'None',
      updated_at = now()
    where id = p_load_id;

    insert into public.notifications (user_id, kind, title, body, entity_type, entity_id)
    values (v_load.poster_user_id, 'system', 'Driver holding overnight 🚚',
      'Your driver will keep the goods in their truck overnight and deliver directly next day (no warehouse stop).',
      'loads', p_load_id);
  else
    -- Undo: restore hub routing and remove the driver bonus.
    update public.loads set
      driver_hold = false,
      provider_net = round(greatest(coalesce(provider_net,0) - coalesce(driver_hold_fee,0), 0), 2),
      driver_hold_fee = 0,
      hub_leg_status = 'Pending',
      pickup_leg_status = 'Open',
      delivery_leg_status = 'None',
      updated_at = now()
    where id = p_load_id;
  end if;

  perform public.write_audit('load.driver_hold', 'loads', p_load_id::text, null,
    jsonb_build_object('hold', coalesce(p_hold, true)), '');
end;
$$;
grant execute on function public.driver_hold_load(uuid, boolean) to authenticated;

-- =========================================================================
-- 5) LEG CLAIM / ASSIGN — pickup leg (pickup->hub) & delivery leg (hub->drop)
-- =========================================================================
-- Shared helper: bind a driver to a leg and wire the active-driver pointer so
-- the existing advance_load lifecycle keeps working for that leg's runner.
create or replace function public.assign_load_leg(
  p_load_id uuid, p_leg text, p_driver_user_id uuid
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_load public.loads;
  v_is_self boolean;
  v_driver_company uuid;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  if p_leg not in ('pickup','delivery') then raise exception 'invalid leg %', p_leg; end if;
  if p_driver_user_id is null then raise exception 'a driver is required'; end if;

  select * into v_load from public.loads where id = p_load_id for update;
  if v_load is null then raise exception 'load not found'; end if;
  if not v_load.uses_hub then raise exception 'this load has no hub legs'; end if;

  v_is_self := (p_driver_user_id = auth.uid());
  -- Self-claim from the open board, OR a dispatcher/admin assigning a driver.
  if not (v_is_self
          or public.is_admin()
          or (v_load.accepted_company_id is not null and public.is_member_of(v_load.accepted_company_id))) then
    raise exception 'not authorized to assign this leg' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_driver_user_id) then
    raise exception 'that driver is not a registered app user';
  end if;
  select company_id into v_driver_company from public.profiles where id = p_driver_user_id;

  if p_leg = 'pickup' then
    if v_load.pickup_leg_driver_user_id is not null and v_load.pickup_leg_driver_user_id <> p_driver_user_id then
      raise exception 'the pickup leg is already taken';
    end if;
    if v_load.hub_leg_status <> 'Pending' then raise exception 'the pickup leg is no longer open'; end if;
    update public.loads set
      pickup_leg_driver_user_id = p_driver_user_id,
      pickup_leg_status = 'Claimed',
      accepted_driver_user_id = coalesce(accepted_driver_user_id, p_driver_user_id),
      accepted_company_id = coalesce(accepted_company_id, v_driver_company),
      accepted_at = coalesce(accepted_at, now()),
      status = case when status = 'Open' then 'Accepted'::load_status else status end,
      updated_at = now()
    where id = p_load_id;
  else -- delivery leg
    if v_load.hub_leg_status <> 'Released' then raise exception 'the goods have not been released from the hub yet'; end if;
    if v_load.delivery_leg_driver_user_id is not null and v_load.delivery_leg_driver_user_id <> p_driver_user_id then
      raise exception 'the delivery leg is already taken';
    end if;
    -- The delivery driver becomes the active runner so they can advance to Delivered.
    update public.loads set
      delivery_leg_driver_user_id = p_driver_user_id,
      delivery_leg_status = 'Claimed',
      accepted_driver_user_id = p_driver_user_id,
      accepted_company_id = coalesce(v_driver_company, accepted_company_id),
      status = case when status in ('Delivered','Cancelled') then status else 'Accepted'::load_status end,
      updated_at = now()
    where id = p_load_id;
  end if;

  if p_driver_user_id <> auth.uid() then
    insert into public.notifications (user_id, kind, title, body, entity_type, entity_id)
    values (p_driver_user_id, 'system', 'New leg assigned 🚚',
      'You were assigned the ' || p_leg || ' leg of a ' || v_load.vehicle_type || ' load.',
      'loads', p_load_id);
  end if;

  perform public.write_audit('load.leg_assigned', 'loads', p_load_id::text, null,
    jsonb_build_object('leg', p_leg, 'driver', p_driver_user_id, 'self', v_is_self), '');
end;
$$;
grant execute on function public.assign_load_leg(uuid, text, uuid) to authenticated;

-- Convenience wrapper: a driver claims a leg for themselves off the open board.
create or replace function public.claim_load_leg(p_load_id uuid, p_leg text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.assign_load_leg(p_load_id, p_leg, auth.uid());
end;
$$;
grant execute on function public.claim_load_leg(uuid, text) to authenticated;
