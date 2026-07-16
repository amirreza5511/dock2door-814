-- Dock2Door — Multi-stop loads
-- ==========================================================================
-- A load can have an ordered list of extra stops (multi-pickup / multi-drop).
-- Stops live in load_stops and are completed one-by-one by the driver. The
-- primary pickup/dropoff on loads stays the canonical first/last leg; extra
-- stops sit in between and drive the dispatch map + driver checklist.
-- Additive + idempotent.
-- ==========================================================================

create table if not exists public.load_stops (
  id uuid primary key default gen_random_uuid(),
  load_id uuid not null references public.loads(id) on delete cascade,
  seq int not null default 0,
  kind text not null default 'Dropoff',            -- 'Pickup' | 'Dropoff'
  label text,
  address text,
  city text,
  lat numeric,
  lng numeric,
  status text not null default 'Pending',           -- 'Pending' | 'Done'
  completed_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_load_stops_load on public.load_stops(load_id, seq);

alter table public.load_stops enable row level security;

-- Any authenticated user tied to the load can read its stops (same posture as
-- loads_read which is authenticated-only; writes go through RPCs).
drop policy if exists "load_stops_read" on public.load_stops;
create policy "load_stops_read" on public.load_stops for select using (public.is_authenticated());

drop policy if exists "load_stops_write_admin" on public.load_stops;
create policy "load_stops_write_admin" on public.load_stops for all using (public.is_admin()) with check (public.is_admin());

-- Replace the full set of extra stops for a load. Only the poster, the carrier
-- company, or the assigned driver may edit. p_stops is a JSON array of
-- { kind, label, address, city, lat, lng }.
create or replace function public.set_load_stops(p_load_id uuid, p_stops jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_load public.loads;
  v_stop jsonb;
  v_i int := 0;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;

  select * into v_load from public.loads where id = p_load_id for update;
  if v_load is null then raise exception 'load not found'; end if;

  if not (
    v_load.poster_user_id = auth.uid()
    or v_load.accepted_driver_user_id = auth.uid()
    or (v_load.accepted_company_id is not null and public.is_member_of(v_load.accepted_company_id))
    or (v_load.poster_company_id is not null and public.is_member_of(v_load.poster_company_id))
    or public.is_admin()
  ) then
    raise exception 'not authorized to edit stops for this load' using errcode = '42501';
  end if;

  -- Wipe and re-insert to keep ordering deterministic. Preserve completed state
  -- for stops that still match by seq is unnecessary — editing resets the plan.
  delete from public.load_stops where load_id = p_load_id;

  if p_stops is not null and jsonb_typeof(p_stops) = 'array' then
    for v_stop in select * from jsonb_array_elements(p_stops) loop
      insert into public.load_stops (load_id, seq, kind, label, address, city, lat, lng)
      values (
        p_load_id,
        v_i,
        coalesce(nullif(v_stop->>'kind', ''), 'Dropoff'),
        nullif(v_stop->>'label', ''),
        nullif(v_stop->>'address', ''),
        nullif(v_stop->>'city', ''),
        (v_stop->>'lat')::numeric,
        (v_stop->>'lng')::numeric
      );
      v_i := v_i + 1;
    end loop;
  end if;

  update public.loads set updated_at = now() where id = p_load_id;
end;
$$;
grant execute on function public.set_load_stops(uuid, jsonb) to authenticated;

-- Driver marks one stop done (or reopens it).
create or replace function public.complete_load_stop(p_stop_id uuid, p_done boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_stop public.load_stops;
  v_load public.loads;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;

  select * into v_stop from public.load_stops where id = p_stop_id for update;
  if v_stop is null then raise exception 'stop not found'; end if;

  select * into v_load from public.loads where id = v_stop.load_id;
  if v_load is null then raise exception 'load not found'; end if;

  if not (
    v_load.accepted_driver_user_id = auth.uid()
    or (v_load.accepted_company_id is not null and public.is_member_of(v_load.accepted_company_id))
    or public.is_admin()
  ) then
    raise exception 'not authorized for this stop' using errcode = '42501';
  end if;

  update public.load_stops
    set status = case when p_done then 'Done' else 'Pending' end,
        completed_at = case when p_done then now() else null end
    where id = p_stop_id;
end;
$$;
grant execute on function public.complete_load_stop(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
