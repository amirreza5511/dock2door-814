-- 0166 — Destination Canada hub on freight requests + live network-hub lookup.
--
-- Adds the destination city-hub a freight request should land at (for ocean
-- LCL/FCL, air, truck and drayage), and a function returning the live
-- network-hub warehouse cities so membership can be derived from real data.

-- 1. Record the chosen destination hub on each freight request.
alter table public.freight_quotes
  add column if not exists dest_hub_id text not null default '',
  add column if not exists dest_hub_city text not null default '',
  add column if not exists dest_hub_is_member boolean not null default false;

-- 2. Recreate freight_create_quote with the new optional hub params.
drop function if exists public.freight_create_quote(
  text, text, text, text, text, text, text, text, numeric, text, numeric, text,
  numeric, numeric, numeric, text, integer, text, numeric, text, text, text,
  date, text, text, text, boolean);

create or replace function public.freight_create_quote(
  p_title text,
  p_origin_country text default '',
  p_origin_city text default '',
  p_origin_port text default '',
  p_dest_country text default '',
  p_dest_city text default '',
  p_dest_port text default '',
  p_freight_mode text default 'ocean',
  p_weight numeric default 0,
  p_weight_unit text default 'kg',
  p_volume numeric default 0,
  p_volume_unit text default 'cbm',
  p_length numeric default 0,
  p_width numeric default 0,
  p_height numeric default 0,
  p_dim_unit text default 'cm',
  p_pieces integer default 1,
  p_commodity text default '',
  p_declared_value numeric default 0,
  p_currency text default 'USD',
  p_hs_code text default '',
  p_notes text default '',
  p_ready_date date default null,
  p_delivery_method text default 'port_delivery',
  p_pickup_address text default '',
  p_pickup_city text default '',
  p_needs_container_pickup boolean default false,
  p_dest_hub_id text default '',
  p_dest_hub_city text default '',
  p_dest_hub_is_member boolean default false
) returns uuid
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_company uuid;
  v_id uuid;
  v_company_name text;
begin
  select cu.company_id into v_company
  from public.company_users cu
  where cu.user_id = auth.uid() and cu.status = 'Active'
  limit 1;
  if v_company is null then
    raise exception 'You need a company account to post a freight request' using errcode='42501';
  end if;
  if coalesce(trim(p_title),'') = '' then
    raise exception 'A short title for the shipment is required';
  end if;

  insert into public.freight_quotes (
    customer_company_id, created_by, title,
    origin_country, origin_city, origin_port,
    dest_country, dest_city, dest_port,
    freight_mode, weight, weight_unit, volume, volume_unit,
    length_val, width_val, height_val, dim_unit, pieces,
    commodity, declared_value, currency, hs_code, notes, ready_date,
    delivery_method, pickup_address, pickup_city, needs_container_pickup,
    dest_hub_id, dest_hub_city, dest_hub_is_member,
    status
  ) values (
    v_company, auth.uid(), trim(p_title),
    coalesce(trim(p_origin_country),''), coalesce(trim(p_origin_city),''), coalesce(trim(p_origin_port),''),
    coalesce(trim(p_dest_country),''), coalesce(trim(p_dest_city),''), coalesce(trim(p_dest_port),''),
    case when p_freight_mode in ('air','ocean','truck','fcl','lcl') then p_freight_mode else 'ocean' end,
    coalesce(p_weight,0),
    case when p_weight_unit in ('kg','lb') then p_weight_unit else 'kg' end,
    coalesce(p_volume,0),
    case when p_volume_unit in ('cbm','cft') then p_volume_unit else 'cbm' end,
    coalesce(p_length,0), coalesce(p_width,0), coalesce(p_height,0),
    case when p_dim_unit in ('cm','in') then p_dim_unit else 'cm' end,
    greatest(coalesce(p_pieces,1),1),
    coalesce(trim(p_commodity),''), coalesce(p_declared_value,0),
    coalesce(nullif(trim(p_currency),''),'USD'), coalesce(trim(p_hs_code),''),
    coalesce(p_notes,''), p_ready_date,
    case when p_delivery_method in ('door_pickup','port_delivery','booking_only') then p_delivery_method else 'port_delivery' end,
    coalesce(trim(p_pickup_address),''), coalesce(trim(p_pickup_city),''),
    coalesce(p_needs_container_pickup,false),
    coalesce(trim(p_dest_hub_id),''), coalesce(trim(p_dest_hub_city),''), coalesce(p_dest_hub_is_member,false),
    'PendingReview'
  ) returning id into v_id;

  select name into v_company_name from public.companies where id = v_company;

  perform public.queue_notification(
    p.id, 'system', 'New freight quote to review',
    coalesce(v_company_name,'A company') || ' posted: ' || trim(p_title),
    'freight_quotes', v_id::text, jsonb_build_object('quote_id', v_id)
  )
  from public.profiles p
  where p.role in ('Admin','SuperAdmin');

  perform public.write_audit('freight.quote_created','freight_quotes', v_id::text, null,
    jsonb_build_object('title', trim(p_title), 'mode', p_freight_mode), null, v_company);
  return v_id;
end;
$function$;

grant execute on function public.freight_create_quote(
  text, text, text, text, text, text, text, text, numeric, text, numeric, text,
  numeric, numeric, numeric, text, integer, text, numeric, text, text, text,
  date, text, text, text, boolean, text, text, boolean) to authenticated;

-- 3. Live network-hub warehouse cities (member hubs come from real data).
create or replace function public.freight_network_hub_cities()
  returns table(city text, hub_count bigint)
  language sql
  stable security definer
  set search_path to 'public'
as $function$
  select lower(trim(w.city)) as city, count(*) as hub_count
  from public.warehouse_listings w
  where w.is_network_hub = true
    and w.status in ('Active','Available')
    and coalesce(trim(w.city),'') <> ''
  group by lower(trim(w.city))
  order by count(*) desc;
$function$;

grant execute on function public.freight_network_hub_cities() to anon, authenticated;
