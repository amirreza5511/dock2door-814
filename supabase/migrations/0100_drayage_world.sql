-- Dock2Door — World 4: Drayage & Freight Forwarder ecosystem
-- Idempotent. Adds:
--   1) DrayageCompany role + company type
--   2) BC port terminals + CN/CP rail terminals (seeded)
--   3) Drayage orders (import/export) with container details
--   4) Drayage moves (legs: port↔depot↔warehouse↔yard↔port)
--   5) Port reservations (date/time from port portal)
--   6) Driver work orders (dispatched moves)
--   7) Live container tracking (GPS pings)
--   8) Prepull support (pick up day before, deliver next day)

-- =========================================================================
-- 1) NEW ROLE + COMPANY TYPE — "DrayageCompany"
-- =========================================================================
do $$ begin
  alter type user_role add value if not exists 'DrayageCompany';
exception when others then null; end $$;

do $$ begin
  alter type company_type add value if not exists 'DrayageCompany';
exception when others then null; end $$;

-- Update handle_new_user to map DrayageCompany role
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
    when 'DrayageCompany' then 'DrayageCompany'::company_type
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
-- 2) TERMINAL ENUMS — port type, terminal type
-- =========================================================================
do $$ begin
  create type terminal_type as enum ('Port', 'Rail', 'Depot', 'Warehouse', 'Yard');
exception when duplicate_object then null; end $$;

do $$ begin
  create type drayage_direction as enum ('Import', 'Export');
exception when duplicate_object then null; end $$;

do $$ begin
  create type drayage_order_status as enum (
    'Open',          -- posted by forwarder/customer, no drayage company assigned yet
    'Assigned',      -- a drayage company claimed it
    'Dispatched',    -- drayage company assigned a driver
    'EnRoute',       -- driver heading to pickup
    'PickedUp',      -- container on the truck / in yard (prepull)
    'InTransit',     -- moving to delivery
    'Delivered',     -- container at destination
    'EmptyReturned', -- export: empty returned to depot
    'Cancelled'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type drayage_move_type as enum (
    'Pickup',        -- pick up container from port/rail/depot/yard
    'Delivery',      -- deliver loaded container to warehouse/customer/yard
    'EmptyReturn',   -- return empty container to depot
    'EmptyPickup',   -- pick up empty container from depot for export
    'YardMove',      -- move container within a yard
    'Prepull'        -- prepull: pick up day before, hold, deliver next day
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type drayage_move_status as enum (
    'Pending',       -- not yet dispatched
    'Assigned',      -- driver assigned
    'EnRoute',       -- heading to origin
    'AtOrigin',      -- arrived at pickup location
    'Loaded',        -- container picked up
    'InTransit',     -- heading to destination
    'AtDestination', -- arrived at drop-off
    'Unloaded',      -- container delivered / dropped
    'Completed',     -- fully done + confirmed
    'Cancelled'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type container_size as enum ('20ft', '40ft', '40HC', '45HC', '53ft');
exception when duplicate_object then null; end $$;

-- =========================================================================
-- 3) TERMINALS TABLE — BC ports + CN/CP rail + depots + yards
-- =========================================================================
create table if not exists public.terminals (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,         -- e.g. VTR, Deltaport, CN-Vancouver
  terminal_type terminal_type not null default 'Port',
  operator text not null default '',  -- VFPA, CN, CP, GCT, DP World, etc.
  address text not null default '',
  city text not null default '',
  geo_lat numeric not null default 0,
  geo_lng numeric not null default 0,
  portal_url text not null default '', -- port reservation portal link
  phone text not null default '',
  hours text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_terminals_type on public.terminals(terminal_type);
create index if not exists idx_terminals_code on public.terminals(code);

alter table public.terminals enable row level security;
drop policy if exists "terminals_read" on public.terminals;
create policy "terminals_read" on public.terminals for select using (public.is_authenticated());
drop policy if exists "terminals_admin" on public.terminals;
create policy "terminals_admin" on public.terminals for all using (public.is_admin()) with check (public.is_admin());

-- =========================================================================
-- 4) DRAYAGE ORDERS — the master order from forwarder/customer
-- =========================================================================
create table if not exists public.drayage_orders (
  id uuid primary key default gen_random_uuid(),
  reference_code text not null default '',
  direction drayage_direction not null,
  status drayage_order_status not null default 'Open',

  -- Who placed the order
  customer_user_id uuid not null references public.profiles(id) on delete cascade,
  customer_company_id uuid references public.companies(id) on delete set null,

  -- Drayage company that claimed it
  drayage_company_id uuid references public.companies(id) on delete set null,

  -- Container details
  container_number text not null default '',
  container_size container_size not null default '40ft',
  container_type text not null default '',  -- standard, reefer, flatrack, tank, etc.
  bol_number text not null default '',       -- bill of lading
  booking_number text not null default '',
  seal_number text not null default '',
  commodity text not null default '',
  weight_kg numeric not null default 0,
  is_hazmat boolean not null default false,
  is_overweight boolean not null default false,
  is_oversized boolean not null default false,
  needs_appt boolean not null default true,

  -- Import: pickup from port/rail, deliver to warehouse/yard
  -- Export: pickup empty from depot, load at warehouse, deliver to port/rail
  origin_terminal_id uuid references public.terminals(id) on delete set null,
  destination_terminal_id uuid references public.terminals(id) on delete set null,
  warehouse_company_id uuid references public.companies(id) on delete set null,

  -- Address for customer warehouse (if not a platform warehouse)
  pickup_address text not null default '',
  pickup_city text not null default '',
  pickup_lat numeric not null default 0,
  pickup_lng numeric not null default 0,
  delivery_address text not null default '',
  delivery_city text not null default '',
  delivery_lat numeric not null default 0,
  delivery_lng numeric not null default 0,

  -- Port reservation (entered by drayage dispatch from port portal)
  port_reservation_date date,
  port_reservation_time text not null default '',
  port_reservation_confirmed boolean not null default false,

  -- Prepull
  is_prepull boolean not null default false,
  prepull_pickup_date date,         -- day before actual delivery
  prepull_yard_terminal_id uuid references public.terminals(id) on delete set null,

  -- Pricing
  quoted_price numeric not null default 0,
  drayage_fee numeric not null default 0,
  fuel_surcharge numeric not null default 0,
  total_price numeric not null default 0,
  currency text not null default 'CAD',

  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  assigned_at timestamptz,
  dispatched_at timestamptz,
  delivered_at timestamptz
);
create index if not exists idx_drayage_orders_status on public.drayage_orders(status);
create index if not exists idx_drayage_orders_customer on public.drayage_orders(customer_company_id);
create index if not exists idx_drayage_orders_drayage on public.drayage_orders(drayage_company_id);
create index if not exists idx_drayage_orders_direction on public.drayage_orders(direction);
create index if not exists idx_drayage_orders_container on public.drayage_orders(container_number);

alter table public.drayage_orders enable row level security;

-- Customer (forwarder) sees their own orders; drayage company sees assigned + Open;
-- driver sees dispatched orders; admin sees all.
drop policy if exists "drayage_orders_read" on public.drayage_orders;
create policy "drayage_orders_read" on public.drayage_orders for select using (
  public.is_admin()
  or (customer_company_id is not null and public.is_member_of(customer_company_id))
  or (customer_user_id = auth.uid())
  or (drayage_company_id is not null and public.is_member_of(drayage_company_id))
  or (warehouse_company_id is not null and public.is_member_of(warehouse_company_id))
  or status = 'Open'  -- open orders visible to any drayage company
);

-- Writes go through SECURITY DEFINER RPCs; only admin direct writes.
drop policy if exists "drayage_orders_admin" on public.drayage_orders;
create policy "drayage_orders_admin" on public.drayage_orders for all using (public.is_admin()) with check (public.is_admin());

-- =========================================================================
-- 5) DRAYAGE MOVES — individual legs within an order
-- =========================================================================
create table if not exists public.drayage_moves (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.drayage_orders(id) on delete cascade,
  move_type drayage_move_type not null,
  status drayage_move_status not null default 'Pending',
  sequence int not null default 0,

  -- From / To (terminal or address)
  from_terminal_id uuid references public.terminals(id) on delete set null,
  to_terminal_id uuid references public.terminals(id) on delete set null,
  from_address text not null default '',
  from_lat numeric not null default 0,
  from_lng numeric not null default 0,
  to_address text not null default '',
  to_lat numeric not null default 0,
  to_lng numeric not null default 0,

  -- Driver assignment
  driver_user_id uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz,
  started_at timestamptz,     -- en route
  picked_up_at timestamptz,   -- container loaded
  delivered_at timestamptz,   -- at destination
  completed_at timestamptz,   -- confirmed

  -- Port appt for this leg
  appt_date date,
  appt_time text not null default '',

  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_drayage_moves_order on public.drayage_moves(order_id);
create index if not exists idx_drayage_moves_driver on public.drayage_moves(driver_user_id);
create index if not exists idx_drayage_moves_status on public.drayage_moves(status);

alter table public.drayage_moves enable row level security;
drop policy if exists "drayage_moves_read" on public.drayage_moves;
create policy "drayage_moves_read" on public.drayage_moves for select using (
  public.is_admin()
  or exists (
    select 1 from public.drayage_orders o
    where o.id = drayage_moves.order_id
    and (
      (o.customer_company_id is not null and public.is_member_of(o.customer_company_id))
      or o.customer_user_id = auth.uid()
      or (o.drayage_company_id is not null and public.is_member_of(o.drayage_company_id))
      or (o.warehouse_company_id is not null and public.is_member_of(o.warehouse_company_id))
    )
  )
  or driver_user_id = auth.uid()
);
drop policy if exists "drayage_moves_admin" on public.drayage_moves;
create policy "drayage_moves_admin" on public.drayage_moves for all using (public.is_admin()) with check (public.is_admin());

-- =========================================================================
-- 6) CONTAINER TRACKING — live GPS pings
-- =========================================================================
create table if not exists public.container_tracking (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.drayage_orders(id) on delete cascade,
  move_id uuid references public.drayage_moves(id) on delete set null,
  driver_user_id uuid references public.profiles(id) on delete set null,
  lat numeric not null,
  lng numeric not null,
  heading numeric not null default 0,
  speed_kph numeric not null default 0,
  accuracy numeric,
  recorded_at timestamptz not null default now()
);
create index if not exists idx_container_tracking_order on public.container_tracking(order_id, recorded_at desc);

alter table public.container_tracking enable row level security;
drop policy if exists "container_tracking_read" on public.container_tracking;
create policy "container_tracking_read" on public.container_tracking for select using (
  public.is_admin()
  or exists (
    select 1 from public.drayage_orders o
    where o.id = container_tracking.order_id
    and (
      (o.customer_company_id is not null and public.is_member_of(o.customer_company_id))
      or o.customer_user_id = auth.uid()
      or (o.drayage_company_id is not null and public.is_member_of(o.drayage_company_id))
    )
  )
  or driver_user_id = auth.uid()
);
drop policy if exists "container_tracking_write" on public.container_tracking;
create policy "container_tracking_write" on public.container_tracking for insert with check (public.is_authenticated());

-- =========================================================================
-- 7) RPCs
-- =========================================================================

-- Create a drayage order (customer/forwarder)
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
  p_is_oversized boolean,
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
  p_notes text
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
    notes
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
    coalesce(p_notes,'')
  ) returning id into v_id;

  perform public.write_audit('drayage_order.created', 'drayage_orders', v_id::text, null,
    jsonb_build_object('ref', v_ref, 'direction', p_direction, 'container', p_container_number), '');
  return v_id;
end;
$$;
grant execute on function public.create_drayage_order(
  drayage_direction, text, container_size, text, text, text, text, numeric,
  boolean, boolean, boolean, uuid, uuid, uuid, text, text, numeric, numeric,
  text, text, numeric, numeric, date, text, boolean, date, uuid, text
) to authenticated;

-- Assign a drayage company to an Open order (drayage company claims it)
create or replace function public.assign_drayage_order(p_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_order public.drayage_orders;
  v_company uuid;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  select * into v_order from public.drayage_orders where id = p_order_id for update;
  if v_order is null then raise exception 'order not found'; end if;
  if v_order.status <> 'Open' then raise exception 'order is no longer open'; end if;

  select company_id into v_company from public.profiles where id = auth.uid();
  if v_company is null then raise exception 'no company associated with your account'; end if;

  update public.drayage_orders
    set status = 'Assigned', drayage_company_id = v_company, assigned_at = now(), updated_at = now()
    where id = p_order_id;

  -- Notify the customer
  insert into public.notifications (user_id, kind, title, body, entity_type, entity_id)
  values (v_order.customer_user_id, 'system', 'Drayage order assigned',
    'A drayage company claimed your order ' || v_order.reference_code,
    'drayage_orders', p_order_id);

  perform public.write_audit('drayage_order.assigned', 'drayage_orders', p_order_id::text, null,
    jsonb_build_object('company', v_company), '');
end;
$$;
grant execute on function public.assign_drayage_order(uuid) to authenticated;

-- Dispatch a driver to a specific move
create or replace function public.dispatch_drayage_move(
  p_move_id uuid,
  p_driver_user_id uuid,
  p_appt_date date default null,
  p_appt_time text default ''
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_move public.drayage_moves;
  v_order public.drayage_orders;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  select * into v_move from public.drayage_moves where id = p_move_id for update;
  if v_move is null then raise exception 'move not found'; end if;

  select * into v_order from public.drayage_orders where id = v_move.order_id;
  if v_order is null then raise exception 'parent order not found'; end if;

  if not (
    (v_order.drayage_company_id is not null and public.is_member_of(v_order.drayage_company_id))
    or public.is_admin()
  ) then
    raise exception 'only the assigned drayage company can dispatch' using errcode = '42501';
  end if;

  if not exists (select 1 from public.profiles where id = p_driver_user_id) then
    raise exception 'driver not found';
  end if;

  update public.drayage_moves
    set driver_user_id = p_driver_user_id, status = 'Assigned',
        appt_date = p_appt_date, appt_time = coalesce(p_appt_time,''),
        assigned_at = now(), updated_at = now()
    where id = p_move_id;

  -- Update order status to Dispatched if first dispatch
  if v_order.status = 'Assigned' then
    update public.drayage_orders set status = 'Dispatched', dispatched_at = now(), updated_at = now()
      where id = v_order.id;
  end if;

  -- Notify driver
  insert into public.notifications (user_id, kind, title, body, entity_type, entity_id)
  values (p_driver_user_id, 'system', 'New drayage work order',
    'You have been dispatched for a ' || v_move.move_type::text || ' move. Check your work orders.',
    'drayage_moves', p_move_id);

  perform public.write_audit('drayage_move.dispatched', 'drayage_moves', p_move_id::text, null,
    jsonb_build_object('driver', p_driver_user_id), '');
end;
$$;
grant execute on function public.dispatch_drayage_move(uuid, uuid, date, text) to authenticated;

-- Update port reservation on an order (dispatch enters from port portal)
create or replace function public.update_port_reservation(
  p_order_id uuid,
  p_reservation_date date,
  p_reservation_time text,
  p_confirmed boolean default false
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_order public.drayage_orders;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  select * into v_order from public.drayage_orders where id = p_order_id for update;
  if v_order is null then raise exception 'order not found'; end if;

  if not (
    (v_order.drayage_company_id is not null and public.is_member_of(v_order.drayage_company_id))
    or v_order.customer_user_id = auth.uid()
    or public.is_admin()
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  update public.drayage_orders
    set port_reservation_date = p_reservation_date,
        port_reservation_time = p_reservation_time,
        port_reservation_confirmed = coalesce(p_confirmed, false),
        updated_at = now()
    where id = p_order_id;

  perform public.write_audit('drayage_order.port_reservation', 'drayage_orders', p_order_id::text, null,
    jsonb_build_object('date', p_reservation_date, 'time', p_reservation_time, 'confirmed', p_confirmed), '');
end;
$$;
grant execute on function public.update_port_reservation(uuid, date, text, boolean) to authenticated;

-- Advance a move status (driver app)
create or replace function public.advance_drayage_move(
  p_move_id uuid,
  p_next_status drayage_move_status
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_move public.drayage_moves;
  v_order public.drayage_orders;
  v_ok boolean := false;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  select * into v_move from public.drayage_moves where id = p_move_id for update;
  if v_move is null then raise exception 'move not found'; end if;

  select * into v_order from public.drayage_orders where id = v_move.order_id;

  if not (
    v_move.driver_user_id = auth.uid()
    or (v_order.drayage_company_id is not null and public.is_member_of(v_order.drayage_company_id))
    or public.is_admin()
  ) then
    raise exception 'not authorized for this move' using errcode = '42501';
  end if;

  v_ok := case
    when v_move.status = 'Pending'    and p_next_status = 'Assigned'    then true
    when v_move.status = 'Assigned'   and p_next_status = 'EnRoute'     then true
    when v_move.status = 'EnRoute'    and p_next_status = 'AtOrigin'    then true
    when v_move.status = 'AtOrigin'   and p_next_status = 'Loaded'      then true
    when v_move.status = 'Loaded'     and p_next_status = 'InTransit'   then true
    when v_move.status = 'InTransit'  and p_next_status = 'AtDestination' then true
    when v_move.status = 'AtDestination' and p_next_status = 'Unloaded' then true
    when v_move.status = 'Unloaded'   and p_next_status = 'Completed'   then true
    when v_move.status in ('Pending','Assigned','EnRoute','AtOrigin','Loaded','InTransit','AtDestination','Unloaded')
         and p_next_status = 'Cancelled' then true
    else false
  end;
  if not v_ok then raise exception 'invalid move transition % -> %', v_move.status, p_next_status; end if;

  update public.drayage_moves set status = p_next_status, updated_at = now(),
    started_at = case when p_next_status = 'EnRoute' then now() else started_at end,
    picked_up_at = case when p_next_status = 'Loaded' then now() else picked_up_at end,
    delivered_at = case when p_next_status = 'AtDestination' then now() else delivered_at end,
    completed_at = case when p_next_status = 'Completed' then now() else completed_at end
    where id = p_move_id;

  -- Update parent order status based on move progression
  if p_next_status = 'EnRoute' then
    update public.drayage_orders set status = 'EnRoute', updated_at = now() where id = v_order.id and status = 'Dispatched';
  elsif p_next_status = 'Loaded' then
    update public.drayage_orders set status = 'PickedUp', updated_at = now() where id = v_order.id;
  elsif p_next_status = 'InTransit' then
    update public.drayage_orders set status = 'InTransit', updated_at = now() where id = v_order.id;
  elsif p_next_status = 'Completed' then
    -- If all moves are completed, mark order delivered
    if not exists (select 1 from public.drayage_moves where order_id = v_order.id and status not in ('Completed','Cancelled')) then
      update public.drayage_orders set status = 'Delivered', delivered_at = now(), updated_at = now() where id = v_order.id;
    end if;
  end if;

  -- Notify customer of progress
  insert into public.notifications (user_id, kind, title, body, entity_type, entity_id)
  values (v_order.customer_user_id, 'system', 'Container update',
    'Your container ' || coalesce(v_order.container_number,'') || ' is now: ' || p_next_status::text,
    'drayage_orders', v_order.id);

  perform public.write_audit('drayage_move.' || lower(p_next_status::text), 'drayage_moves', p_move_id::text, null,
    jsonb_build_object('from', v_move.status, 'to', p_next_status), '');
end;
$$;
grant execute on function public.advance_drayage_move(uuid, drayage_move_status) to authenticated;

-- Record a GPS ping for container tracking
create or replace function public.ping_container_location(
  p_order_id uuid,
  p_move_id uuid default null,
  p_lat numeric,
  p_lng numeric,
  p_heading numeric default 0,
  p_speed_kph numeric default 0,
  p_accuracy numeric default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  insert into public.container_tracking (order_id, move_id, driver_user_id, lat, lng, heading, speed_kph, accuracy)
  values (p_order_id, p_move_id, auth.uid(), p_lat, p_lng, coalesce(p_heading,0), coalesce(p_speed_kph,0), p_accuracy);
end;
$$;
grant execute on function public.ping_container_location(uuid, uuid, numeric, numeric, numeric, numeric, numeric) to authenticated;

-- =========================================================================
-- 8) SEED BC PORTS + CN/CP RAIL TERMINALS
-- =========================================================================
insert into public.terminals (name, code, terminal_type, operator, address, city, geo_lat, geo_lng, portal_url, hours) values
  -- BC Ports (Vancouver area)
  ('Centerm (GCT)', 'CTM', 'Port', 'GCT Global Container Terminals', '1200 Stewart St', 'Vancouver', 49.2906, -123.0840, 'https://www.gctterminals.com/', '24/7'),
  ('Deltaport', 'DLP', 'Port', 'GCT Global Container Terminals', '5400 Roberts Bank Rd', 'Delta', 49.0060, -123.1820, 'https://www.gctterminals.com/', '24/7'),
  ('Vanterm (GCT)', 'VTR', 'Port', 'GCT Global Container Terminals', '1055 Stewart St', 'Vancouver', 49.2930, -123.0870, 'https://www.gctterminals.com/', '24/7'),
  ('DP World Vancouver', 'DPW', 'Port', 'DP World Vancouver', '2800 Commissionaire St', 'Vancouver', 49.2780, -123.0820, 'https://www.dpworldvancouver.com/', '24/7'),
  ('Fraser Surrey Docks', 'FSD', 'Port', 'Fraser Surrey Docks LP', '11060 Elevator Rd', 'Surrey', 49.1720, -122.9080, 'https://www.fsd.bc.ca/', '0600-1600'),
  ('Pacific Coast Terminals', 'PCT', 'Port', 'Pacific Coast Terminals', '2300 Stewart St', 'Port Moody', 49.2840, -122.8290, 'https://www.pct.ca/', '0700-1700'),
  ('Prince Rupert Port', 'PRP', 'Port', 'Prince Rupert Port Authority', '200 First Ave W', 'Prince Rupert', 54.3160, -130.3200, 'https://www.rupertport.com/', '24/7'),
  ('DP World Prince Rupert', 'DPR', 'Port', 'DP World', 'Kaien Island', 'Prince Rupert', 54.2240, -130.3380, 'https://www.dpworld.com/', '24/7'),
  ('Nanaimo Port', 'NAN', 'Port', 'Nanaimo Port Authority', '100 Port Dr', 'Nanaimo', 49.1660, -123.9400, 'https://www.npa.bc.ca/', '0800-1700'),
  ('Port of Victoria', 'VIC', 'Port', 'Greater Victoria Harbour Authority', '468 Belleville St', 'Victoria', 48.4210, -123.3680, 'https://www.gvhacapitalregion.ca/', '0800-1700'),

  -- CN Rail Terminals
  ('CN Vancouver Intermodal', 'CN-VAN', 'Rail', 'Canadian National Railway', '6900 Miller Rd', 'Richmond', 49.1860, -123.0840, 'https://www.cn.ca/', '24/7'),
  ('CN Surrey Intermodal', 'CN-SUR', 'Rail', 'Canadian National Railway', '9600 192 St', 'Surrey', 49.1330, -122.7300, 'https://www.cn.ca/', '24/7'),
  ('CN Prince George', 'CN-PG', 'Rail', 'Canadian National Railway', '1555 Highway 97 S', 'Prince George', 53.8780, -122.7800, 'https://www.cn.ca/', '0700-1900'),
  ('CN Prince Rupert', 'CN-PR', 'Rail', 'Canadian National Railway', 'Kaien Island', 'Prince Rupert', 54.2260, -130.3360, 'https://www.cn.ca/', '24/7'),
  ('CN Edmonton', 'CN-EDM', 'Rail', 'Canadian National Railway', '7931 51 Ave', 'Edmonton', 53.4760, -113.4600, 'https://www.cn.ca/', '24/7'),
  ('CN Calgary', 'CN-CGY', 'Rail', 'Canadian National Railway', '1402 50 Ave SE', 'Calgary', 51.0280, -114.0200, 'https://www.cn.ca/', '24/7'),

  -- CP Rail (CPKC) Terminals
  ('CP Vancouver Intermodal', 'CP-VAN', 'Rail', 'CP Kansas City', '2790 Commissioner St', 'Vancouver', 49.2780, -123.0530, 'https://www.cpkcr.com/', '24/7'),
  ('CP Surrey Intermodal', 'CP-SUR', 'Rail', 'CP Kansas City', '9600 192 St', 'Surrey', 49.1330, -122.7300, 'https://www.cpkcr.com/', '24/7'),
  ('CP Calgary Intermodal', 'CP-CGY', 'Rail', 'CP Kansas City', '1402 50 Ave SE', 'Calgary', 51.0280, -114.0200, 'https://www.cpkcr.com/', '24/7'),
  ('CP Edmonton Intermodal', 'CP-EDM', 'Rail', 'CP Kansas City', '7931 51 Ave', 'Edmonton', 53.4760, -113.4600, 'https://www.cpkcr.com/', '24/7'),
  ('CP Montreal Intermodal', 'CP-MTL', 'Rail', 'CP Kansas City', '1100 de la Cathédrale', 'Montreal', 49.3520, -73.5740, 'https://www.cpkcr.com/', '24/7'),
  ('CP Toronto Intermodal', 'CP-TOR', 'Rail', 'CP Kansas City', '999 Cawthra Rd', 'Mississauga', 43.5800, -79.6000, 'https://www.cpkcr.com/', '24/7')
on conflict (code) do nothing;
