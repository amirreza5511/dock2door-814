-- Dock2Door — Chassis & equipment tracking, per diem/demurrage/storage, POD & inspection
-- ==========================================================================
-- Additive + idempotent. Builds on 0002 (fleet), 0100 (drayage), 0115 (rate cards).
--   1) chassis as a first-class fleet entity (number separate from truck)
--   2) rental + live-location columns on chassis and trailers
--   3) equipment linkage + free-day / accessorial fields on drayage_orders
--   4) shipping lines (global seed + per-company custom)
--   5) equipment inspections (container + chassis, pickup/drop)
--   6) drayage documents (POD / BOL / interchange, multi-page + signature)
--   7) RPCs for all of the above
-- ==========================================================================

-- --------------------------------------------------------------------------
-- 1) CHASSIS — first-class fleet entity (like trucks / trailers)
-- --------------------------------------------------------------------------
create table if not exists public.chassis (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  chassis_number text not null,           -- physical chassis id, distinct from truck number
  plate text not null default '',
  chassis_type text not null default '',  -- 20ft, 40ft, tri-axle, slider, gooseneck, etc.
  status fleet_status not null default 'Active',
  -- ownership / rental
  is_rental boolean not null default false,
  rental_daily_rate numeric not null default 0,
  rental_return_date date,
  -- live location: attached to a truck OR dropped somewhere
  current_truck_id uuid references public.trucks(id) on delete set null,
  is_dropped boolean not null default false,
  dropped_lat numeric,
  dropped_lng numeric,
  dropped_label text not null default '',
  dropped_at timestamptz,
  data jsonb not null default '{}'::jsonb,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_chassis_company on public.chassis(company_id);
create index if not exists idx_chassis_truck on public.chassis(current_truck_id);

alter table public.chassis enable row level security;
drop policy if exists "chassis_company" on public.chassis;
create policy "chassis_company" on public.chassis for all
  using (public.is_admin() or company_id = public.my_company_id())
  with check (public.is_admin() or company_id = public.my_company_id());

-- --------------------------------------------------------------------------
-- 2) RENTAL + LIVE-LOCATION columns on trailers (parity with chassis)
-- --------------------------------------------------------------------------
alter table public.trailers
  add column if not exists is_rental boolean not null default false,
  add column if not exists rental_daily_rate numeric not null default 0,
  add column if not exists rental_return_date date,
  add column if not exists current_truck_id uuid references public.trucks(id) on delete set null,
  add column if not exists is_dropped boolean not null default false,
  add column if not exists dropped_lat numeric,
  add column if not exists dropped_lng numeric,
  add column if not exists dropped_label text not null default '',
  add column if not exists dropped_at timestamptz;

-- --------------------------------------------------------------------------
-- 3) EQUIPMENT LINKAGE + ACCESSORIAL / FREE-DAY fields on drayage_orders
-- --------------------------------------------------------------------------
alter table public.drayage_orders
  add column if not exists truck_id uuid references public.trucks(id) on delete set null,
  add column if not exists chassis_id uuid references public.chassis(id) on delete set null,
  add column if not exists trailer_id uuid references public.trailers(id) on delete set null,
  add column if not exists shipping_line_id uuid,
  -- MT (empty) container reported by driver
  add column if not exists mt_reported_at timestamptz,
  -- per diem (steamship line container rent)
  add column if not exists per_diem_free_days int not null default 0,
  add column if not exists per_diem_last_free_day date,
  add column if not exists per_diem_daily_rate numeric not null default 0,
  -- demurrage (container sitting at the port/terminal)
  add column if not exists demurrage_free_days int not null default 0,
  add column if not exists demurrage_last_free_day date,
  add column if not exists demurrage_daily_rate numeric not null default 0,
  -- storage (yard / warehouse storage)
  add column if not exists storage_free_days int not null default 0,
  add column if not exists storage_last_free_day date,
  add column if not exists storage_daily_rate numeric not null default 0;

-- --------------------------------------------------------------------------
-- 4) SHIPPING LINES — global seed (company_id null) + per-company custom
-- --------------------------------------------------------------------------
create table if not exists public.shipping_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade, -- null => global
  name text not null,
  scac text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_shipping_lines_company on public.shipping_lines(company_id);

alter table public.shipping_lines enable row level security;
drop policy if exists "shipping_lines_read" on public.shipping_lines;
create policy "shipping_lines_read" on public.shipping_lines for select using (
  public.is_admin() or company_id is null or (company_id is not null and public.is_member_of(company_id))
);
drop policy if exists "shipping_lines_manage" on public.shipping_lines;
create policy "shipping_lines_manage" on public.shipping_lines for all using (
  public.is_admin() or (company_id is not null and public.is_member_of(company_id))
) with check (
  public.is_admin() or (company_id is not null and public.is_member_of(company_id))
);

insert into public.shipping_lines (company_id, name, scac) values
  (null, 'Maersk', 'MAEU'),
  (null, 'MSC (Mediterranean Shipping)', 'MSCU'),
  (null, 'CMA CGM', 'CMDU'),
  (null, 'COSCO Shipping', 'COSU'),
  (null, 'Hapag-Lloyd', 'HLCU'),
  (null, 'Ocean Network Express (ONE)', 'ONEY'),
  (null, 'Evergreen Line', 'EGLV'),
  (null, 'Yang Ming', 'YMLU'),
  (null, 'HMM', 'HDMU'),
  (null, 'ZIM', 'ZIMU'),
  (null, 'OOCL', 'OOLU'),
  (null, 'PIL (Pacific International Lines)', 'PABV'),
  (null, 'Wan Hai Lines', 'WHLC'),
  (null, 'Matson', 'MATS'),
  (null, 'Westwood Shipping Lines', 'WWSU'),
  (null, 'SM Line', 'SMLM'),
  (null, 'TS Lines', 'TSLU'),
  (null, 'Sealand', 'SEAU')
on conflict do nothing;

-- --------------------------------------------------------------------------
-- 5) EQUIPMENT INSPECTIONS — container + chassis, at pickup / drop
-- --------------------------------------------------------------------------
create table if not exists public.equipment_inspections (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.drayage_orders(id) on delete cascade,
  move_id uuid references public.drayage_moves(id) on delete set null,
  company_id uuid references public.companies(id) on delete set null,
  inspector_user_id uuid references public.profiles(id) on delete set null,
  inspector_role text not null default 'Driver',    -- Driver, OwnerOperator, Yard, Dispatch
  equipment_type text not null default 'Container',  -- Container | Chassis
  reference text not null default '',                -- container/chassis number
  phase text not null default 'Pickup',              -- Pickup | Drop
  condition text not null default 'Good',            -- Good | Damaged
  damage_notes text not null default '',
  photo_paths jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_equipment_inspections_order on public.equipment_inspections(order_id);

alter table public.equipment_inspections enable row level security;
drop policy if exists "equipment_inspections_read" on public.equipment_inspections;
create policy "equipment_inspections_read" on public.equipment_inspections for select using (
  public.is_admin()
  or inspector_user_id = auth.uid()
  or (company_id is not null and public.is_member_of(company_id))
  or exists (
    select 1 from public.drayage_orders o
    where o.id = equipment_inspections.order_id
    and (
      (o.customer_company_id is not null and public.is_member_of(o.customer_company_id))
      or o.customer_user_id = auth.uid()
      or (o.drayage_company_id is not null and public.is_member_of(o.drayage_company_id))
    )
  )
);
drop policy if exists "equipment_inspections_write" on public.equipment_inspections;
create policy "equipment_inspections_write" on public.equipment_inspections for insert
  with check (public.is_authenticated());

-- --------------------------------------------------------------------------
-- 6) DRAYAGE DOCUMENTS — POD / BOL / interchange (multi-page + signature)
-- --------------------------------------------------------------------------
create table if not exists public.drayage_documents (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.drayage_orders(id) on delete cascade,
  company_id uuid references public.companies(id) on delete set null,
  uploaded_by uuid references public.profiles(id) on delete set null,
  doc_type text not null default 'POD',              -- POD | BOL | Interchange | Other
  file_paths jsonb not null default '[]'::jsonb,     -- multi-page scan
  signer_name text not null default '',
  signed_at timestamptz,
  notes text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_drayage_documents_order on public.drayage_documents(order_id);

alter table public.drayage_documents enable row level security;
drop policy if exists "drayage_documents_read" on public.drayage_documents;
create policy "drayage_documents_read" on public.drayage_documents for select using (
  public.is_admin()
  or uploaded_by = auth.uid()
  or exists (
    select 1 from public.drayage_orders o
    where o.id = drayage_documents.order_id
    and (
      (o.customer_company_id is not null and public.is_member_of(o.customer_company_id))
      or o.customer_user_id = auth.uid()
      or (o.drayage_company_id is not null and public.is_member_of(o.drayage_company_id))
    )
  )
);
drop policy if exists "drayage_documents_write" on public.drayage_documents;
create policy "drayage_documents_write" on public.drayage_documents for insert
  with check (public.is_authenticated());

-- ==========================================================================
-- 7) RPCs
-- ==========================================================================

-- Helper: assert current user is a member of the order's drayage company.
create or replace function public.assert_drayage_owner(p_order public.drayage_orders)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (
    (p_order.drayage_company_id is not null and public.is_member_of(p_order.drayage_company_id))
    or public.is_admin()
  ) then
    raise exception 'only the assigned drayage company can do this' using errcode = '42501';
  end if;
end;
$$;

-- Link a full equipment set (truck + chassis + trailer) to an order and attach
-- the chassis/trailer to the truck (so their live location follows the truck).
create or replace function public.assign_drayage_equipment(
  p_order_id uuid,
  p_truck_id uuid default null,
  p_chassis_id uuid default null,
  p_trailer_id uuid default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_order public.drayage_orders;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  select * into v_order from public.drayage_orders where id = p_order_id for update;
  if v_order is null then raise exception 'order not found'; end if;
  perform public.assert_drayage_owner(v_order);

  update public.drayage_orders
    set truck_id = p_truck_id, chassis_id = p_chassis_id, trailer_id = p_trailer_id, updated_at = now()
    where id = p_order_id;

  if p_chassis_id is not null then
    update public.chassis
      set current_truck_id = p_truck_id, is_dropped = false, updated_at = now()
      where id = p_chassis_id;
  end if;
  if p_trailer_id is not null then
    update public.trailers
      set current_truck_id = p_truck_id, is_dropped = false, updated_at = now()
      where id = p_trailer_id;
  end if;

  perform public.write_audit('drayage_order.equipment', 'drayage_orders', p_order_id::text, null,
    jsonb_build_object('truck', p_truck_id, 'chassis', p_chassis_id, 'trailer', p_trailer_id), '');
end;
$$;
grant execute on function public.assign_drayage_equipment(uuid, uuid, uuid, uuid) to authenticated;

-- Drop a chassis/trailer at a location (truck goes bobtail).
create or replace function public.drop_equipment(
  p_equipment_type text,
  p_equipment_id uuid,
  p_lat numeric default null,
  p_lng numeric default null,
  p_label text default ''
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  if p_equipment_type = 'chassis' then
    update public.chassis set is_dropped = true, current_truck_id = null,
      dropped_lat = p_lat, dropped_lng = p_lng, dropped_label = coalesce(p_label,''), dropped_at = now(), updated_at = now()
      where id = p_equipment_id and (public.is_admin() or company_id = public.my_company_id());
  elsif p_equipment_type = 'trailer' then
    update public.trailers set is_dropped = true, current_truck_id = null,
      dropped_lat = p_lat, dropped_lng = p_lng, dropped_label = coalesce(p_label,''), dropped_at = now(), updated_at = now()
      where id = p_equipment_id and (public.is_admin() or company_id = public.my_company_id());
  else
    raise exception 'invalid equipment type';
  end if;
end;
$$;
grant execute on function public.drop_equipment(text, uuid, numeric, numeric, text) to authenticated;

-- Re-attach a dropped chassis/trailer to a truck (pick it back up).
create or replace function public.pickup_equipment(
  p_equipment_type text,
  p_equipment_id uuid,
  p_truck_id uuid default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  if p_equipment_type = 'chassis' then
    update public.chassis set is_dropped = false, current_truck_id = p_truck_id, dropped_at = null, updated_at = now()
      where id = p_equipment_id and (public.is_admin() or company_id = public.my_company_id());
  elsif p_equipment_type = 'trailer' then
    update public.trailers set is_dropped = false, current_truck_id = p_truck_id, dropped_at = null, updated_at = now()
      where id = p_equipment_id and (public.is_admin() or company_id = public.my_company_id());
  else
    raise exception 'invalid equipment type';
  end if;
end;
$$;
grant execute on function public.pickup_equipment(text, uuid, uuid) to authenticated;

-- Dispatch sets the free-day windows + daily rates for per diem / demurrage / storage.
create or replace function public.set_drayage_charges(
  p_order_id uuid,
  p_per_diem_free_days int default null,
  p_per_diem_last_free_day date default null,
  p_per_diem_daily_rate numeric default null,
  p_demurrage_free_days int default null,
  p_demurrage_last_free_day date default null,
  p_demurrage_daily_rate numeric default null,
  p_storage_free_days int default null,
  p_storage_last_free_day date default null,
  p_storage_daily_rate numeric default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_order public.drayage_orders;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  select * into v_order from public.drayage_orders where id = p_order_id for update;
  if v_order is null then raise exception 'order not found'; end if;
  perform public.assert_drayage_owner(v_order);

  update public.drayage_orders set
    per_diem_free_days     = coalesce(p_per_diem_free_days, per_diem_free_days),
    per_diem_last_free_day = coalesce(p_per_diem_last_free_day, per_diem_last_free_day),
    per_diem_daily_rate    = coalesce(p_per_diem_daily_rate, per_diem_daily_rate),
    demurrage_free_days     = coalesce(p_demurrage_free_days, demurrage_free_days),
    demurrage_last_free_day = coalesce(p_demurrage_last_free_day, demurrage_last_free_day),
    demurrage_daily_rate    = coalesce(p_demurrage_daily_rate, demurrage_daily_rate),
    storage_free_days     = coalesce(p_storage_free_days, storage_free_days),
    storage_last_free_day = coalesce(p_storage_last_free_day, storage_last_free_day),
    storage_daily_rate    = coalesce(p_storage_daily_rate, storage_daily_rate),
    updated_at = now()
  where id = p_order_id;
end;
$$;
grant execute on function public.set_drayage_charges(uuid, int, date, numeric, int, date, numeric, int, date, numeric) to authenticated;

-- Set the shipping line on an order.
create or replace function public.set_order_shipping_line(p_order_id uuid, p_shipping_line_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_order public.drayage_orders;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  select * into v_order from public.drayage_orders where id = p_order_id for update;
  if v_order is null then raise exception 'order not found'; end if;
  perform public.assert_drayage_owner(v_order);
  update public.drayage_orders set shipping_line_id = p_shipping_line_id, updated_at = now() where id = p_order_id;
end;
$$;
grant execute on function public.set_order_shipping_line(uuid, uuid) to authenticated;

-- Add a custom shipping line for the current company.
create or replace function public.add_shipping_line(p_name text, p_scac text default '')
returns public.shipping_lines language plpgsql security definer set search_path = public as $$
declare v_company uuid; v_row public.shipping_lines;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  select company_id into v_company from public.profiles where id = auth.uid();
  if v_company is null then raise exception 'no company context' using errcode = '42501'; end if;
  insert into public.shipping_lines (company_id, name, scac)
    values (v_company, p_name, coalesce(p_scac,'')) returning * into v_row;
  return v_row;
end;
$$;
grant execute on function public.add_shipping_line(text, text) to authenticated;

-- Driver reports the empty (MT) container number picked up from port / off-dock.
create or replace function public.report_empty_container(p_order_id uuid, p_container_number text)
returns void language plpgsql security definer set search_path = public as $$
declare v_order public.drayage_orders;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  select * into v_order from public.drayage_orders where id = p_order_id for update;
  if v_order is null then raise exception 'order not found'; end if;
  if not (
    exists (select 1 from public.drayage_moves m where m.order_id = p_order_id and m.driver_user_id = auth.uid())
    or (v_order.drayage_company_id is not null and public.is_member_of(v_order.drayage_company_id))
    or public.is_admin()
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  update public.drayage_orders
    set container_number = coalesce(nullif(p_container_number,''), container_number),
        mt_reported_at = now(), updated_at = now()
    where id = p_order_id;

  -- Notify the drayage dispatch (order owner company members via customer/dispatch notification).
  if v_order.drayage_company_id is not null then
    insert into public.notifications (user_id, kind, title, body, entity_type, entity_id)
    select p.id, 'system', 'Empty container reported',
      'Driver reported MT container ' || p_container_number || ' for ' || v_order.reference_code,
      'drayage_orders', p_order_id
    from public.company_users cu join public.profiles p on p.id = cu.user_id
    where cu.company_id = v_order.drayage_company_id and cu.status = 'Active';
  end if;

  perform public.write_audit('drayage_order.mt_reported', 'drayage_orders', p_order_id::text, null,
    jsonb_build_object('container', p_container_number), '');
end;
$$;
grant execute on function public.report_empty_container(uuid, text) to authenticated;

-- Record a container/chassis inspection.
create or replace function public.record_equipment_inspection(
  p_order_id uuid,
  p_equipment_type text,
  p_reference text,
  p_phase text,
  p_condition text,
  p_damage_notes text default '',
  p_photo_paths jsonb default '[]'::jsonb,
  p_move_id uuid default null,
  p_inspector_role text default 'Driver'
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_company uuid; v_id uuid;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  select drayage_company_id into v_company from public.drayage_orders where id = p_order_id;
  insert into public.equipment_inspections (
    order_id, move_id, company_id, inspector_user_id, inspector_role,
    equipment_type, reference, phase, condition, damage_notes, photo_paths
  ) values (
    p_order_id, p_move_id, v_company, auth.uid(), coalesce(p_inspector_role,'Driver'),
    coalesce(p_equipment_type,'Container'), coalesce(p_reference,''), coalesce(p_phase,'Pickup'),
    coalesce(p_condition,'Good'), coalesce(p_damage_notes,''), coalesce(p_photo_paths,'[]'::jsonb)
  ) returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.record_equipment_inspection(uuid, text, text, text, text, text, jsonb, uuid, text) to authenticated;

-- Attach a document (POD / BOL / interchange) to an order.
create or replace function public.add_drayage_document(
  p_order_id uuid,
  p_doc_type text,
  p_file_paths jsonb,
  p_signer_name text default '',
  p_notes text default ''
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_company uuid; v_id uuid;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  select drayage_company_id into v_company from public.drayage_orders where id = p_order_id;
  insert into public.drayage_documents (order_id, company_id, uploaded_by, doc_type, file_paths, signer_name, signed_at, notes)
  values (
    p_order_id, v_company, auth.uid(), coalesce(p_doc_type,'POD'), coalesce(p_file_paths,'[]'::jsonb),
    coalesce(p_signer_name,''), case when coalesce(p_signer_name,'') <> '' then now() else null end, coalesce(p_notes,'')
  ) returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.add_drayage_document(uuid, text, jsonb, text, text) to authenticated;

notify pgrst, 'reload schema';
