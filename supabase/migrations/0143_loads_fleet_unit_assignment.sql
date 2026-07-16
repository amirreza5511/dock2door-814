-- Dock2Door — Full set dispatch (driver + truck + trailer)
-- ==========================================================================
-- Lets a carrier attach a specific truck and trailer to an active load, so the
-- whole set (driver + truck + trailer) travels together and shows on the board
-- and public tracking. Additive + idempotent.
-- ==========================================================================

alter table public.loads add column if not exists assigned_truck_id uuid references public.trucks(id) on delete set null;
alter table public.loads add column if not exists assigned_trailer_id uuid references public.trailers(id) on delete set null;

create index if not exists idx_loads_assigned_truck on public.loads(assigned_truck_id) where assigned_truck_id is not null;
create index if not exists idx_loads_assigned_trailer on public.loads(assigned_trailer_id) where assigned_trailer_id is not null;

-- Attach (or clear) a truck / trailer on an active load. Pass null to unassign.
create or replace function public.set_load_fleet(p_load_id uuid, p_truck_id uuid default null, p_trailer_id uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_load public.loads;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;

  select * into v_load from public.loads where id = p_load_id for update;
  if v_load is null then raise exception 'load not found'; end if;

  if not (
    (v_load.accepted_company_id is not null and public.is_member_of(v_load.accepted_company_id))
    or public.is_admin()
  ) then
    raise exception 'only the carrier company can assign fleet units' using errcode = '42501';
  end if;

  -- Units must belong to the same carrier company (when provided).
  if p_truck_id is not null and not exists (
    select 1 from public.trucks t where t.id = p_truck_id and t.company_id = v_load.accepted_company_id
  ) then
    raise exception 'that truck is not in your fleet';
  end if;
  if p_trailer_id is not null and not exists (
    select 1 from public.trailers tr where tr.id = p_trailer_id and tr.company_id = v_load.accepted_company_id
  ) then
    raise exception 'that trailer is not in your fleet';
  end if;

  update public.loads
    set assigned_truck_id = p_truck_id,
        assigned_trailer_id = p_trailer_id,
        updated_at = now()
    where id = p_load_id;

  perform public.write_audit('load.fleet_assigned', 'loads', p_load_id::text, null,
    jsonb_build_object('truck', p_truck_id, 'trailer', p_trailer_id), '');
end;
$$;
grant execute on function public.set_load_fleet(uuid, uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
