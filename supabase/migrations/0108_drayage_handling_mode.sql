-- Dock2Door — Drayage handling mode (Live Load / Live Unload / Drop & Pick)
-- + a definitive fix for the create_drayage_order overload ambiguity.
--
-- Symptom: submitting a container order fails ("Drayage module is not ready yet"
-- / "Could not find the function public.create_drayage_order(...)").
--
-- This migration:
--   1) adds a handling_mode column (how the container is handled at the stop) plus
--      an optional pickup-back date for the Drop & Pick flow,
--   2) DROPS every existing overload of create_drayage_order dynamically (so no
--      stale/ambiguous signature can survive), then
--   3) recreates ONE canonical function that also accepts the new handling fields,
--      and forces a PostgREST schema-cache reload.

-- =========================================================================
-- 1) New columns on drayage_orders
-- =========================================================================
do $$ begin
  create type drayage_handling_mode as enum ('LiveLoad', 'LiveUnload', 'DropPick');
exception when duplicate_object then null; end $$;

alter table public.drayage_orders
  add column if not exists handling_mode drayage_handling_mode not null default 'LiveUnload';

alter table public.drayage_orders
  add column if not exists pickup_back_date date;

-- =========================================================================
-- 2) Drop EVERY existing create_drayage_order overload dynamically
-- =========================================================================
do $$
declare
  r record;
begin
  for r in
    select 'drop function if exists public.' || p.oid::regprocedure::text || ';' as stmt
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_drayage_order'
  loop
    execute r.stmt;
  end loop;
end $$;

-- =========================================================================
-- 3) Canonical function (optional trailing args carry defaults)
-- =========================================================================
create or replace function public.create_drayage_order(
  p_direction drayage_direction,
  p_container_number text,
  p_container_size container_size,
  p_container_type text,
  p_bol_number text,
  p_booking_number text,
  p_commodity text,
  p_weight_kg numeric,
  p_is_hazmat boolean,
  p_is_overweight boolean,
  p_origin_terminal_id uuid,
  p_destination_terminal_id uuid,
  p_warehouse_company_id uuid,
  p_pickup_address text,
  p_pickup_city text,
  p_pickup_lat numeric,
  p_pickup_lng numeric,
  p_delivery_address text,
  p_delivery_city text,
  p_delivery_lat numeric,
  p_delivery_lng numeric,
  p_port_reservation_date date,
  p_port_reservation_time text,
  p_is_prepull boolean,
  p_prepull_pickup_date date,
  p_prepull_yard_terminal_id uuid,
  p_notes text,
  p_is_oversized boolean default false,
  p_target_drayage_company_id uuid default null,
  p_handling_mode drayage_handling_mode default 'LiveUnload',
  p_pickup_back_date date default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_company uuid;
  v_ref text;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  select company_id into v_company from public.profiles where id = auth.uid();

  v_ref := 'DRY-' || to_char(now(), 'YYMMDD') || '-' || substr(gen_random_uuid()::text, 1, 6);

  insert into public.drayage_orders (
    reference_code, direction, status,
    customer_user_id, customer_company_id,
    container_number, container_size, container_type,
    bol_number, booking_number, commodity, weight_kg,
    is_hazmat, is_overweight, is_oversized,
    origin_terminal_id, destination_terminal_id, warehouse_company_id,
    pickup_address, pickup_city, pickup_lat, pickup_lng,
    delivery_address, delivery_city, delivery_lat, delivery_lng,
    port_reservation_date, port_reservation_time,
    is_prepull, prepull_pickup_date, prepull_yard_terminal_id,
    notes, target_drayage_company_id,
    handling_mode, pickup_back_date
  ) values (
    v_ref, p_direction, 'Open',
    auth.uid(), v_company,
    coalesce(p_container_number,''), coalesce(p_container_size,'40ft'), coalesce(p_container_type,''),
    coalesce(p_bol_number,''), coalesce(p_booking_number,''), coalesce(p_commodity,''), greatest(coalesce(p_weight_kg,0),0),
    coalesce(p_is_hazmat,false), coalesce(p_is_overweight,false), coalesce(p_is_oversized,false),
    p_origin_terminal_id, p_destination_terminal_id, p_warehouse_company_id,
    coalesce(p_pickup_address,''), coalesce(p_pickup_city,''), greatest(coalesce(p_pickup_lat,0),0), greatest(coalesce(p_pickup_lng,0),0),
    coalesce(p_delivery_address,''), coalesce(p_delivery_city,''), greatest(coalesce(p_delivery_lat,0),0), greatest(coalesce(p_delivery_lng,0),0),
    p_port_reservation_date, coalesce(p_port_reservation_time,''),
    coalesce(p_is_prepull,false), p_prepull_pickup_date, p_prepull_yard_terminal_id,
    coalesce(p_notes,''), p_target_drayage_company_id,
    coalesce(p_handling_mode,'LiveUnload'), p_pickup_back_date
  ) returning id into v_id;

  -- Notify the targeted drayage company (all its members) that they were invited.
  if p_target_drayage_company_id is not null then
    insert into public.notifications (user_id, kind, title, body, entity_type, entity_id)
    select cu.user_id, 'system', 'New drayage invitation',
      'You were invited to quote on order ' || v_ref,
      'drayage_orders', v_id
    from public.company_users cu
    where cu.company_id = p_target_drayage_company_id and cu.status = 'Active';
  end if;

  perform public.write_audit('drayage_order.created', 'drayage_orders', v_id::text, null,
    jsonb_build_object('ref', v_ref, 'direction', p_direction, 'container', p_container_number,
      'target', p_target_drayage_company_id, 'handling', p_handling_mode), '');
  return v_id;
end;
$$;

grant execute on function public.create_drayage_order(
  drayage_direction, text, container_size, text, text, text, text, numeric,
  boolean, boolean, uuid, uuid, uuid, text, text, numeric, numeric,
  text, text, numeric, numeric, date, text, boolean, date, uuid, text,
  boolean, uuid, drayage_handling_mode, date
) to authenticated;

-- =========================================================================
-- 4) Force PostgREST to reload its schema cache so the new signature is seen
-- =========================================================================
notify pgrst, 'reload schema';
