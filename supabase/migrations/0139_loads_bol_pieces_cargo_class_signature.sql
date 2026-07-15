-- ---------------------------------------------------------------------------
-- 0139 — Bill of Lading (BOL), per-piece labels + QR, cargo-class pricing &
--        delivery signature capture.
-- ---------------------------------------------------------------------------
-- Builds on 0137/0138 (freight hubs & legs). Adds:
--   1) A cargo *class* on every load (General, Cigarettes, Alcohol, Hazardous,
--      Furniture, Chemical, Food, UnusualLoad, NonStandardPallet) with an
--      admin-tunable percentage surcharge that flows into quote_load / post_load.
--   2) A BOL number on each load + a load_pieces table: one scannable row per
--      pallet/box carrying a unique barcode used for the printed labels & QR.
--   3) post_load now stamps the cargo-class surcharge, a BOL number, and spawns
--      the piece rows automatically.
--   4) scan_load_piece(barcode) — driver scans a piece at pickup; returns the
--      live scanned/total progress for the load.
--   5) A signature_path column + advance_load extended to store the receiver's
--      drawn signature alongside the delivery photo & name.
-- Additive & idempotent. Existing callers keep working (new params default).

-- =========================================================================
-- 1) CARGO CLASS — surcharge lookup (admin-tunable) + load columns
-- =========================================================================
create table if not exists public.cargo_class_surcharges (
  class        text primary key,
  label        text not null default '',
  surcharge_pct numeric not null default 0,
  note         text not null default '',
  sort_order   int not null default 0,
  updated_at   timestamptz not null default now()
);

-- Seed sensible defaults (only inserts missing rows; never clobbers admin edits).
insert into public.cargo_class_surcharges (class, label, surcharge_pct, note, sort_order) values
  ('General',            'General cargo',        0,  '',                                                    0),
  ('Food',               'Food / Groceries',     5,  'Perishable — keep cold chain where required.',        1),
  ('Furniture',          'Furniture',            10, 'Bulky / blanket-wrap handling.',                      2),
  ('NonStandardPallet',  'Non-standard pallet',  12, 'Oversized or irregular pallet footprint.',            3),
  ('Cigarettes',         'Cigarettes / Tobacco', 15, 'Excise-controlled — keep manifest & seals.',          4),
  ('Alcohol',            'Alcohol',              20, 'Licensed goods — ID may be required on delivery.',    5),
  ('UnusualLoad',        'Unusual / Non-standard load', 20, 'Special dimensions or handling.',              6),
  ('Chemical',           'Chemical',             25, 'Follow SDS handling & segregation rules.',            7),
  ('Hazardous',          'Hazardous / Dangerous goods', 35, 'DG declaration & placards required.',          8)
on conflict (class) do nothing;

alter table public.cargo_class_surcharges enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='cargo_class_surcharges' and policyname='cargo_class_read') then
    create policy cargo_class_read on public.cargo_class_surcharges for select using (true);
  end if;
end $$;

alter table public.loads add column if not exists cargo_class text not null default 'General';
alter table public.loads add column if not exists cargo_class_surcharge numeric not null default 0;
alter table public.loads add column if not exists bol_number text not null default '';
alter table public.loads add column if not exists signature_path text not null default '';

-- =========================================================================
-- 2) LOAD PIECES — one scannable label per pallet / box
-- =========================================================================
create table if not exists public.load_pieces (
  id           uuid primary key default gen_random_uuid(),
  load_id      uuid not null references public.loads(id) on delete cascade,
  piece_no     int not null,
  total_pieces int not null,
  barcode      text not null unique,
  cargo_class  text not null default 'General',
  label        text not null default '',
  weight_kg    numeric not null default 0,
  scanned      boolean not null default false,
  scanned_at   timestamptz,
  scanned_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists idx_load_pieces_load on public.load_pieces(load_id);
create index if not exists idx_load_pieces_barcode on public.load_pieces(barcode);

alter table public.load_pieces enable row level security;
-- Anyone tied to the load (poster, accepted driver, hub/accepted company, admin)
-- can read its pieces; scanning is done through the security-definer RPC below.
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='load_pieces' and policyname='load_pieces_read') then
    create policy load_pieces_read on public.load_pieces for select using (
      exists (
        select 1 from public.loads l where l.id = load_pieces.load_id and (
          l.poster_user_id = auth.uid()
          or l.accepted_driver_user_id = auth.uid()
          or l.pickup_leg_driver_user_id = auth.uid()
          or l.delivery_leg_driver_user_id = auth.uid()
          or (l.accepted_company_id is not null and public.is_member_of(l.accepted_company_id))
          or (l.hub_company_id is not null and public.is_member_of(l.hub_company_id))
          or public.is_admin()
        )
      )
    );
  end if;
end $$;

-- Short human-friendly barcode/BOL helper: 6 chars of a uuid, upper-cased.
create or replace function public.short_code(n int default 6)
returns text language sql volatile as $$
  select upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, greatest(n,4)));
$$;

-- =========================================================================
-- 3) QUOTE_LOAD — now applies the cargo-class surcharge
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
  p_storage_payer text default 'shipper',
  p_cargo_class text default 'General'
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
  v_class text;
  v_class_pct numeric := 0;
  v_class_surcharge numeric := 0;
begin
  v_payer := case when p_storage_payer = 'receiver' then 'receiver' else 'shipper' end;
  v_pallets := greatest(coalesce(p_pallets, 0), 0);
  v_class := coalesce(nullif(p_cargo_class, ''), 'General');

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

  -- Cargo-class surcharge (percentage of transport). Falls back to 0 for General.
  select coalesce(surcharge_pct, 0) into v_class_pct
    from public.cargo_class_surcharges where class = v_class;
  v_class_pct := coalesce(v_class_pct, 0);
  v_class_surcharge := round(v_freight * (v_class_pct / 100.0), 2);
  v_freight := round(v_freight + v_class_surcharge, 2);

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
    'cargoClass', v_class,
    'cargoClassPct', v_class_pct,
    'cargoClassSurcharge', v_class_surcharge,
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
grant execute on function public.quote_load(numeric, numeric, numeric, numeric, load_vehicle_type, int, text, load_cargo_type, numeric, numeric, text, text) to authenticated;

-- =========================================================================
-- 4) POST_LOAD — stamps cargo class + surcharge, BOL number, spawns pieces
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
  p_storage_payer text default 'shipper',
  p_cargo_class text default 'General'
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_q jsonb;
  v_company uuid;
  v_id uuid;
  v_uses_hub boolean;
  v_hub_id uuid;
  v_hub_company uuid;
  v_hub_name text := '';
  v_class text;
  v_bol text;
  v_pieces int;
  v_per_piece_wt numeric;
  i int;
  v_from text;
  v_to text;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  if p_delivery_speed not in ('SameDay','NextDay') then raise exception 'invalid delivery speed'; end if;
  v_class := coalesce(nullif(p_cargo_class, ''), 'General');

  v_q := public.quote_load(
    p_pickup_lat, p_pickup_lng, p_dropoff_lat, p_dropoff_lng,
    p_vehicle_type, p_pallets, p_delivery_speed, p_cargo_type, p_weight_kg, p_distance_km, p_storage_payer, v_class);
  select company_id into v_company from public.profiles where id = auth.uid();

  v_uses_hub := coalesce((v_q->>'usesHub')::boolean, false);
  if v_uses_hub then
    select h.id, h.company_id, h.name into v_hub_id, v_hub_company, v_hub_name
      from public.find_nearest_hub(p_pickup_lat, p_pickup_lng) h;
  end if;

  v_bol := 'BOL-' || to_char(now(), 'YYMMDD') || '-' || public.short_code(5);

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
    pickup_leg_status, delivery_leg_status,
    cargo_class, cargo_class_surcharge, bol_number
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
    'None',
    v_class, (v_q->>'cargoClassSurcharge')::numeric, v_bol
  ) returning id into v_id;

  -- Spawn one scannable piece per pallet (palletised) / per item otherwise.
  if coalesce(p_cargo_type,'Pallet') in ('Envelope','Box') then
    v_pieces := greatest(coalesce(p_item_count,1), 1);
  else
    v_pieces := greatest(coalesce(p_pallets,1), 1);
  end if;
  v_pieces := least(v_pieces, 200); -- guardrail
  v_per_piece_wt := round(greatest(coalesce(p_weight_kg,0),0) / v_pieces, 2);
  v_from := split_part(coalesce(nullif(p_pickup_city,''), p_pickup_address, ''), ',', 1);
  v_to := split_part(coalesce(nullif(p_dropoff_city,''), p_dropoff_address, ''), ',', 1);

  for i in 1..v_pieces loop
    insert into public.load_pieces (load_id, piece_no, total_pieces, barcode, cargo_class, label, weight_kg)
    values (
      v_id, i, v_pieces,
      v_bol || '-' || lpad(i::text, 3, '0'),
      v_class,
      'Piece ' || i || ' of ' || v_pieces,
      v_per_piece_wt
    );
  end loop;

  perform public.write_audit('load.posted', 'loads', v_id::text, null,
    jsonb_build_object('vehicle', p_vehicle_type, 'cargo', p_cargo_type, 'class', v_class, 'pallets', p_pallets,
      'pieces', v_pieces, 'bol', v_bol, 'total', (v_q->>'totalPrice')::numeric, 'usesHub', v_uses_hub, 'hub', v_hub_name), '');
  return v_id;
end;
$$;
grant execute on function public.post_load(numeric, numeric, text, text, numeric, numeric, text, text, load_vehicle_type, int, text, text, load_cargo_type, int, numeric, numeric, numeric, numeric, text, text, text, numeric, text, text) to authenticated;

-- =========================================================================
-- 5) SCAN A PIECE — driver scans a label's barcode at pickup
-- =========================================================================
create or replace function public.scan_load_piece(p_barcode text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_piece public.load_pieces;
  v_load public.loads;
  v_scanned int;
  v_total int;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  if coalesce(p_barcode,'') = '' then raise exception 'no barcode'; end if;

  select * into v_piece from public.load_pieces where barcode = trim(p_barcode) for update;
  if v_piece is null then raise exception 'unknown label — this code is not part of any shipment'; end if;

  select * into v_load from public.loads where id = v_piece.load_id;
  if v_load is null then raise exception 'load not found'; end if;

  if not (public.is_admin()
          or v_load.accepted_driver_user_id = auth.uid()
          or v_load.pickup_leg_driver_user_id = auth.uid()
          or v_load.delivery_leg_driver_user_id = auth.uid()
          or (v_load.accepted_company_id is not null and public.is_member_of(v_load.accepted_company_id))) then
    raise exception 'you are not assigned to this shipment' using errcode = '42501';
  end if;

  if not v_piece.scanned then
    update public.load_pieces
       set scanned = true, scanned_at = now(), scanned_by = auth.uid()
     where id = v_piece.id;
  end if;

  select count(*) filter (where scanned), count(*) into v_scanned, v_total
    from public.load_pieces where load_id = v_piece.load_id;

  return jsonb_build_object(
    'loadId', v_piece.load_id,
    'bolNumber', v_load.bol_number,
    'pieceNo', v_piece.piece_no,
    'totalPieces', v_piece.total_pieces,
    'scannedCount', v_scanned,
    'totalCount', v_total,
    'alreadyScanned', v_piece.scanned,
    'complete', v_scanned >= v_total
  );
end;
$$;
grant execute on function public.scan_load_piece(text) to authenticated;

-- =========================================================================
-- 6) ADVANCE_LOAD — record the drawn signature on delivery
-- =========================================================================
drop function if exists public.advance_load(uuid, load_status, text, text);

create or replace function public.advance_load(
  p_load_id uuid,
  p_next_status load_status,
  p_proof_photo_path text default null,
  p_receiver_name text default null,
  p_signature_path text default null
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
      signature_path = coalesce(nullif(p_signature_path, ''), signature_path),
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
grant execute on function public.advance_load(uuid, load_status, text, text, text) to authenticated;

-- =========================================================================
-- 7) ADMIN — tune a cargo-class surcharge
-- =========================================================================
create or replace function public.admin_set_cargo_class_surcharge(
  p_class text, p_surcharge_pct numeric, p_label text default null, p_note text default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_admin();
  insert into public.cargo_class_surcharges (class, label, surcharge_pct, note)
  values (p_class, coalesce(p_label, p_class), greatest(coalesce(p_surcharge_pct,0),0), coalesce(p_note,''))
  on conflict (class) do update set
    surcharge_pct = greatest(coalesce(excluded.surcharge_pct,0),0),
    label = coalesce(nullif(excluded.label,''), public.cargo_class_surcharges.label),
    note = coalesce(nullif(excluded.note,''), public.cargo_class_surcharges.note),
    updated_at = now();
  perform public.write_audit('cargo_class.surcharge', 'cargo_class_surcharges', p_class, null,
    jsonb_build_object('pct', p_surcharge_pct), '');
end;
$$;
grant execute on function public.admin_set_cargo_class_surcharge(text, numeric, text, text) to authenticated;

-- Refresh PostgREST schema cache so the new/updated signatures are seen.
notify pgrst, 'reload schema';
