-- ---------------------------------------------------------------------------
-- 0136 — Let the client feed a real road-driving distance into load pricing.
-- ---------------------------------------------------------------------------
-- The map now draws a real street-following route (OSRM) and knows the true
-- driving distance, which is meaningfully longer than the great-circle line.
-- We add an OPTIONAL trailing p_distance_km param to quote_load / post_load:
--   * when provided (> 0) it is used as the pricing distance;
--   * when NULL/0 we fall back to the existing haversine estimate.
-- Additive & idempotent. Existing callers (no p_distance_km) keep working.

-- =========================================================================
-- quote_load — price breakdown, now honoring an optional road distance.
-- =========================================================================
create or replace function public.quote_load(
  p_pickup_lat numeric, p_pickup_lng numeric,
  p_dropoff_lat numeric, p_dropoff_lng numeric,
  p_vehicle_type load_vehicle_type,
  p_pallets int,
  p_delivery_speed text,
  p_cargo_type load_cargo_type default 'Pallet',
  p_weight_kg numeric default 0,
  p_distance_km numeric default null
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
  -- Prefer a real road distance when the caller supplies one.
  if p_distance_km is not null and p_distance_km > 0 then
    v_distance := round(p_distance_km::numeric, 2);
  else
    v_distance := public.load_distance_km(p_pickup_lat, p_pickup_lng, p_dropoff_lat, p_dropoff_lng);
  end if;

  select company_id into v_company from public.profiles where id = auth.uid();

  select rc.base_price, rc.per_km, rc.per_pallet,
         case when p_delivery_speed = 'SameDay' then rc.same_day_multiplier else 1.0 end
    into v_base, v_per_km, v_per_pallet, v_speed_mult
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

  v_weight_fee := round(greatest(coalesce(p_weight_kg, 0) - 50, 0) * 0.05, 2);

  v_freight := round((v_base + v_per_km * v_distance + v_per_pallet * greatest(coalesce(p_pallets, 0), 0) + v_weight_fee) * v_speed_mult, 2);

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
grant execute on function public.quote_load(numeric, numeric, numeric, numeric, load_vehicle_type, int, text, load_cargo_type, numeric, numeric) to authenticated;

-- =========================================================================
-- post_load — persist a load, now honoring an optional road distance.
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
  p_distance_km numeric default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_q jsonb;
  v_company uuid;
  v_id uuid;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  if p_delivery_speed not in ('SameDay','NextDay') then raise exception 'invalid delivery speed'; end if;

  v_q := public.quote_load(p_pickup_lat, p_pickup_lng, p_dropoff_lat, p_dropoff_lng, p_vehicle_type, p_pallets, p_delivery_speed, p_cargo_type, p_weight_kg, p_distance_km);
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
grant execute on function public.post_load(numeric, numeric, text, text, numeric, numeric, text, text, load_vehicle_type, int, text, text, load_cargo_type, int, numeric, numeric, numeric, numeric, text, text, text, numeric) to authenticated;
