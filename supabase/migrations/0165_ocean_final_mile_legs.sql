-- =========================================================================
-- 0165 — LCL/FCL final-mile legs for the ocean booking board.
-- Idempotent & additive. Safe to run multiple times.
--
-- Extends 0162 ocean_requests so an accepted container booking can route
-- through a destination warehouse city and finish with a last-mile local
-- delivery. Each shipment gets an ordered set of LEGS (origin port → ocean
-- transit → destination port → local warehouse → final-mile door) with clear
-- per-leg status tracking (Pending → Active → Done) and notifications.
--
--   load_type is derived from container_size: 'LCL' when container_size='LCL',
--   otherwise 'FCL'. Full containers skip the shared-warehouse deconsolidation
--   leg unless the customer explicitly requests a warehouse handoff.
-- =========================================================================

-- ─── 1) ocean_requests — final-mile + load-type columns ─────────────────────
alter table public.ocean_requests add column if not exists load_type text not null default 'FCL'
  check (load_type in ('FCL','LCL'));
alter table public.ocean_requests add column if not exists needs_final_mile boolean not null default false;
alter table public.ocean_requests add column if not exists dest_warehouse_id uuid references public.warehouse_listings(id) on delete set null;
alter table public.ocean_requests add column if not exists dest_warehouse_name text not null default '';
alter table public.ocean_requests add column if not exists final_mile_address text not null default '';
alter table public.ocean_requests add column if not exists final_mile_city text not null default '';
alter table public.ocean_requests add column if not exists final_mile_contact text not null default '';
alter table public.ocean_requests add column if not exists final_mile_phone text not null default '';

-- Backfill load_type from container_size for existing rows.
update public.ocean_requests
   set load_type = case when container_size = 'LCL' then 'LCL' else 'FCL' end
 where load_type is distinct from (case when container_size = 'LCL' then 'LCL' else 'FCL' end);

-- ─── 2) ocean_legs — ordered shipment legs ──────────────────────────────────
create table if not exists public.ocean_legs (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.ocean_requests(id) on delete cascade,
  seq int not null default 0,
  leg_type text not null
    check (leg_type in ('OriginPort','OceanTransit','DestPort','Warehouse','FinalMile')),
  title text not null default '',
  status text not null default 'Pending'
    check (status in ('Pending','Active','Done')),
  started_at timestamptz,
  completed_at timestamptz,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (request_id, seq)
);
create index if not exists idx_ocean_legs_request on public.ocean_legs(request_id, seq);

alter table public.ocean_legs enable row level security;

drop policy if exists "ocean_legs_read" on public.ocean_legs;
create policy "ocean_legs_read" on public.ocean_legs for select using (
  public.is_ocean_party(request_id)
);

-- Writes go through security-definer RPCs; block direct table writes.
drop policy if exists "ocean_legs_write" on public.ocean_legs;
create policy "ocean_legs_write" on public.ocean_legs for all
  using (public.is_admin()) with check (public.is_admin());

-- ─── 3) Setup / update the final-mile plan and (re)seed legs ─────────────────
create or replace function public.ocean_setup_final_mile(
  p_request_id uuid,
  p_needs_final_mile boolean default true,
  p_dest_warehouse_id uuid default null,
  p_final_mile_address text default '',
  p_final_mile_city text default '',
  p_final_mile_contact text default '',
  p_final_mile_phone text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.ocean_requests;
  v_wh_name text := '';
  v_seq int := 0;
  v_is_lcl boolean;
begin
  select * into v_req from public.ocean_requests where id = p_request_id for update;
  if v_req is null then raise exception 'Request not found' using errcode='P0002'; end if;
  if not public.is_ocean_party(p_request_id) then
    raise exception 'You are not part of this shipment' using errcode='42501';
  end if;
  if v_req.status = 'Cancelled' then
    raise exception 'This shipment is cancelled';
  end if;

  if p_dest_warehouse_id is not null then
    select name into v_wh_name from public.warehouse_listings where id = p_dest_warehouse_id;
  end if;

  update public.ocean_requests
     set needs_final_mile = coalesce(p_needs_final_mile, false),
         dest_warehouse_id = p_dest_warehouse_id,
         dest_warehouse_name = coalesce(v_wh_name,''),
         final_mile_address = coalesce(trim(p_final_mile_address),''),
         final_mile_city = coalesce(trim(p_final_mile_city),''),
         final_mile_contact = coalesce(trim(p_final_mile_contact),''),
         final_mile_phone = coalesce(trim(p_final_mile_phone),''),
         updated_at = now()
   where id = p_request_id;

  -- Rebuild the leg plan from scratch (keeps this call idempotent).
  delete from public.ocean_legs where request_id = p_request_id;

  v_is_lcl := (v_req.load_type = 'LCL' or v_req.container_size = 'LCL');

  insert into public.ocean_legs (request_id, seq, leg_type, title, status)
  values (p_request_id, 0, 'OriginPort',
          coalesce(nullif(v_req.origin_port,''), v_req.origin_country, 'Origin port') || ' — export handoff', 'Pending');
  v_seq := 1;

  insert into public.ocean_legs (request_id, seq, leg_type, title, status)
  values (p_request_id, v_seq, 'OceanTransit', 'Ocean transit', 'Pending');
  v_seq := v_seq + 1;

  insert into public.ocean_legs (request_id, seq, leg_type, title, status)
  values (p_request_id, v_seq, 'DestPort',
          coalesce(nullif(v_req.dest_port,''), v_req.dest_country, 'Destination port') || ' — arrival & customs', 'Pending');
  v_seq := v_seq + 1;

  -- LCL always deconsolidates at a warehouse; FCL only when a warehouse is chosen.
  if v_is_lcl or p_dest_warehouse_id is not null then
    insert into public.ocean_legs (request_id, seq, leg_type, title, status)
    values (p_request_id, v_seq, 'Warehouse',
            coalesce(nullif(v_wh_name,''), 'Local warehouse') ||
            case when v_is_lcl then ' — deconsolidation' else ' — handling' end, 'Pending');
    v_seq := v_seq + 1;
  end if;

  if coalesce(p_needs_final_mile, false) then
    insert into public.ocean_legs (request_id, seq, leg_type, title, status)
    values (p_request_id, v_seq, 'FinalMile',
            'Final-mile delivery' ||
            case when coalesce(trim(p_final_mile_city),'') <> '' then ' to ' || trim(p_final_mile_city) else '' end, 'Pending');
    v_seq := v_seq + 1;
  end if;

  perform public.write_audit('ocean.final_mile_setup','ocean_requests', p_request_id::text, null,
    jsonb_build_object('finalMile', coalesce(p_needs_final_mile,false), 'warehouse', p_dest_warehouse_id,
      'loadType', v_req.load_type, 'legs', v_seq), null, v_req.customer_company_id);
end;
$$;
grant execute on function public.ocean_setup_final_mile(uuid, boolean, uuid, text, text, text, text) to authenticated;

-- ─── 4) Advance a leg: mark it Done and activate the next one ────────────────
create or replace function public.ocean_advance_leg(p_leg_id uuid, p_notes text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_leg public.ocean_legs;
  v_req public.ocean_requests;
  v_next public.ocean_legs;
  v_remaining int;
begin
  select * into v_leg from public.ocean_legs where id = p_leg_id for update;
  if v_leg is null then raise exception 'Leg not found' using errcode='P0002'; end if;
  select * into v_req from public.ocean_requests where id = v_leg.request_id for update;
  if not public.is_ocean_party(v_leg.request_id) then
    raise exception 'You are not part of this shipment' using errcode='42501';
  end if;
  if v_leg.status = 'Done' then
    raise exception 'This leg is already complete';
  end if;

  update public.ocean_legs
     set status = 'Done',
         started_at = coalesce(started_at, now()),
         completed_at = now(),
         notes = case when coalesce(trim(p_notes),'') <> '' then trim(p_notes) else notes end,
         updated_at = now()
   where id = p_leg_id;

  -- Activate the next pending leg in order, if any.
  select * into v_next from public.ocean_legs
   where request_id = v_leg.request_id and status = 'Pending'
   order by seq asc limit 1;
  if v_next.id is not null then
    update public.ocean_legs
       set status = 'Active', started_at = coalesce(started_at, now()), updated_at = now()
     where id = v_next.id;
  end if;

  -- Keep the request status in step with leg progress.
  select count(*) into v_remaining from public.ocean_legs
   where request_id = v_leg.request_id and status <> 'Done';
  if v_remaining = 0 then
    update public.ocean_requests
       set status = 'Completed', completed_at = coalesce(completed_at, now()), updated_at = now()
     where id = v_leg.request_id and status <> 'Cancelled';
  elsif v_req.status = 'Booked' then
    update public.ocean_requests
       set status = 'InTransit', updated_at = now()
     where id = v_leg.request_id;
  end if;

  perform public.queue_notification(
    cu.user_id, 'system', 'Ocean shipment update',
    v_req.title || ' — ' || v_leg.title || ' complete',
    'ocean_requests', v_leg.request_id::text,
    jsonb_build_object('request_id', v_leg.request_id, 'leg', v_leg.leg_type)
  )
  from public.company_users cu
  where cu.company_id = v_req.customer_company_id and cu.status = 'Active';

  perform public.write_audit('ocean.leg_advanced','ocean_legs', p_leg_id::text, null,
    jsonb_build_object('leg', v_leg.leg_type, 'request', v_leg.request_id), null, v_req.customer_company_id);
end;
$$;
grant execute on function public.ocean_advance_leg(uuid, text) to authenticated;

-- ─── 5) List legs for a shipment ────────────────────────────────────────────
create or replace function public.ocean_list_legs(p_request_id uuid)
returns table (
  id uuid, seq int, leg_type text, title text, status text,
  started_at timestamptz, completed_at timestamptz, notes text
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_ocean_party(p_request_id) then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  return query
  select l.id, l.seq, l.leg_type, l.title, l.status, l.started_at, l.completed_at, l.notes
  from public.ocean_legs l
  where l.request_id = p_request_id
  order by l.seq asc;
end; $$;
grant execute on function public.ocean_list_legs(uuid) to authenticated;

-- ─── 6) Keep load_type in sync when new requests are created ─────────────────
create or replace function public.ocean_sync_load_type()
returns trigger language plpgsql set search_path = public as $$
begin
  new.load_type := case when new.container_size = 'LCL' then 'LCL' else 'FCL' end;
  return new;
end;
$$;

drop trigger if exists trg_ocean_sync_load_type on public.ocean_requests;
create trigger trg_ocean_sync_load_type
  before insert or update of container_size on public.ocean_requests
  for each row execute function public.ocean_sync_load_type();
