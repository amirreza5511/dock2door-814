-- Dock2Door — Freight & Delivery world (Onro-style)
-- Idempotent. Adds:
--   1) A dedicated "Shipper" role + company type so freight has its own login.
--   2) Cargo types (Envelope -> Box -> Pallet -> Crate -> Container -> Full load)
--      with dimensions (L x W x H + weight) and recipient details on each load.
--   3) Updated quote/post RPCs that accept the new cargo fields.

-- =========================================================================
-- 1) NEW ROLE + COMPANY TYPE — "Shipper"
-- =========================================================================
do $$ begin
  alter type user_role add value if not exists 'Shipper';
exception when others then null; end $$;

do $$ begin
  alter type company_type add value if not exists 'Shipper';
exception when others then null; end $$;

-- =========================================================================
-- 2) CARGO TYPE ENUM + LOAD COLUMNS (dimensions, recipient)
-- =========================================================================
do $$ begin
  create type load_cargo_type as enum
    ('Envelope','Box','Pallet','Crate','Container','FullLoad');
exception when duplicate_object then null; end $$;

alter table public.loads add column if not exists cargo_type load_cargo_type not null default 'Pallet';
alter table public.loads add column if not exists item_count int not null default 1;
alter table public.loads add column if not exists weight_kg numeric not null default 0;
alter table public.loads add column if not exists length_cm numeric not null default 0;
alter table public.loads add column if not exists width_cm numeric not null default 0;
alter table public.loads add column if not exists height_cm numeric not null default 0;
alter table public.loads add column if not exists item_description text not null default '';
alter table public.loads add column if not exists recipient_name text not null default '';
alter table public.loads add column if not exists recipient_phone text not null default '';

-- =========================================================================
-- 3) MAP THE NEW ROLE -> COMPANY TYPE IN handle_new_user
-- =========================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role user_role;
  v_requested_role text;
  v_name text;
  v_company_id uuid;
  v_company_name text;
  v_company_city text;
  v_company_type company_type;
begin
  v_requested_role := new.raw_user_meta_data->>'role';

  if v_requested_role in ('Admin', 'SuperAdmin') then
    v_role := 'Customer'::user_role;
    raise warning 'handle_new_user: blocked self-assignment of privileged role % for %', v_requested_role, new.email;
  else
    v_role := coalesce(v_requested_role::user_role, 'Customer'::user_role);
  end if;

  v_name := coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1));
  v_company_name := new.raw_user_meta_data->>'company_name';
  v_company_city := coalesce(new.raw_user_meta_data->>'city', 'Vancouver');

  v_company_type := case v_role
    when 'Customer' then 'Customer'::company_type
    when 'WarehouseProvider' then 'WarehouseProvider'::company_type
    when 'ServiceProvider' then 'ServiceProvider'::company_type
    when 'Employer' then 'Employer'::company_type
    when 'TruckingCompany' then 'TruckingCompany'::company_type
    when 'GateStaff' then 'WarehouseProvider'::company_type
    when 'Shipper' then 'Shipper'::company_type
    else null
  end;

  if v_company_type is not null and coalesce(v_company_name, '') <> '' then
    insert into public.companies (name, type, city, status)
    values (v_company_name, v_company_type, v_company_city, 'PendingApproval')
    returning id into v_company_id;
  end if;

  insert into public.profiles (id, email, name, role, company_id)
  values (new.id, new.email, v_name, v_role, v_company_id);

  if v_company_id is not null then
    insert into public.company_users (company_id, user_id, company_role, status)
    values (v_company_id, new.id, 'Owner', 'Active');
  end if;

  return new;
end;
$$;

-- =========================================================================
-- 4) QUOTE — extend with cargo type + weight (kept backward compatible).
--    Drops the old 7-arg version and recreates with the cargo args defaulted.
-- =========================================================================
drop function if exists public.quote_load(numeric, numeric, numeric, numeric, load_vehicle_type, int, text);

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
  v_per_pallet numeric := 8;
  v_speed_mult numeric;
  v_weight_fee numeric;
  v_freight numeric;
  v_commission_pct numeric := 12;
  v_booking_fee numeric := 5;
  v_commission numeric;
  v_platform numeric;
begin
  v_distance := public.load_distance_km(p_pickup_lat, p_pickup_lng, p_dropoff_lat, p_dropoff_lng);

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

  -- Heavy cargo surcharge: $0.05/kg over 50kg (keeps small parcels cheap).
  v_weight_fee := round(greatest(coalesce(p_weight_kg, 0) - 50, 0) * 0.05, 2);

  v_freight := round((v_base + v_per_km * v_distance + v_per_pallet * greatest(coalesce(p_pallets, 0), 0) + v_weight_fee) * v_speed_mult, 2);

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
grant execute on function public.quote_load(numeric, numeric, numeric, numeric, load_vehicle_type, int, text, load_cargo_type, numeric) to authenticated;

-- =========================================================================
-- 5) POST A LOAD — extend with cargo type, dimensions, recipient.
-- =========================================================================
drop function if exists public.post_load(numeric, numeric, text, text, numeric, numeric, text, text, load_vehicle_type, int, text, text);

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
  p_recipient_phone text default ''
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_q jsonb;
  v_company uuid;
  v_id uuid;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  if p_delivery_speed not in ('SameDay','NextDay') then raise exception 'invalid delivery speed'; end if;

  v_q := public.quote_load(p_pickup_lat, p_pickup_lng, p_dropoff_lat, p_dropoff_lng, p_vehicle_type, p_pallets, p_delivery_speed, p_cargo_type, p_weight_kg);
  select company_id into v_company from public.profiles where id = auth.uid();

  insert into public.loads (
    poster_user_id, poster_company_id,
    pickup_lat, pickup_lng, pickup_address, pickup_city,
    dropoff_lat, dropoff_lng, dropoff_address, dropoff_city,
    vehicle_type, pallets, delivery_speed, notes,
    cargo_type, item_count, weight_kg, length_cm, width_cm, height_cm,
    item_description, recipient_name, recipient_phone,
    distance_km, freight_price, commission_amount, booking_fee,
    platform_earnings, provider_net, total_price, currency, status
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
    (v_q->>'totalPrice')::numeric, 'CAD', 'Open'
  ) returning id into v_id;

  perform public.write_audit('load.posted', 'loads', v_id::text, null,
    jsonb_build_object('vehicle', p_vehicle_type, 'cargo', p_cargo_type, 'pallets', p_pallets, 'total', (v_q->>'totalPrice')::numeric), '');
  return v_id;
end;
$$;
grant execute on function public.post_load(numeric, numeric, text, text, numeric, numeric, text, text, load_vehicle_type, int, text, text, load_cargo_type, int, numeric, numeric, numeric, numeric, text, text, text) to authenticated;
