-- 0028_driver_yard_slots.sql
-- Yard slot grid (A1-A5, B1-B5, C1-C5) for driver/dispatcher assignment.
-- Idempotent.

create table if not exists public.yard_slots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  code text not null,
  zone text not null,
  position int not null,
  status text not null default 'free' check (status in ('free','reserved','occupied','blocked')),
  current_truck_plate text,
  current_trailer_number text,
  current_appointment_id uuid,
  driver_user_id uuid references auth.users(id) on delete set null,
  notes text,
  updated_at timestamptz not null default now(),
  unique (company_id, code)
);

create index if not exists idx_yard_slots_company on public.yard_slots(company_id);
create index if not exists idx_yard_slots_status on public.yard_slots(company_id, status);

alter table public.yard_slots enable row level security;

drop policy if exists "yard_slots_read" on public.yard_slots;
create policy "yard_slots_read" on public.yard_slots for select
  using (public.is_member_of(company_id) or public.is_admin());

drop policy if exists "yard_slots_write" on public.yard_slots;
create policy "yard_slots_write" on public.yard_slots for all
  using (public.is_member_of(company_id) or public.is_admin())
  with check (public.is_member_of(company_id) or public.is_admin());

-- Touch updated_at
create or replace function public.tg_yard_slots_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists tr_yard_slots_touch on public.yard_slots;
create trigger tr_yard_slots_touch before update on public.yard_slots
for each row execute function public.tg_yard_slots_touch();

-- Seed standard A1-A5, B1-B5, C1-C5 grid for any warehouse company that has none.
create or replace function public.yard_slots_seed_default(p_company_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_inserted int := 0;
  v_zone text;
  v_pos int;
begin
  if not (public.is_member_of(p_company_id) or public.is_admin()) then
    raise exception 'forbidden';
  end if;
  for v_zone in select unnest(array['A','B','C']) loop
    for v_pos in 1..5 loop
      insert into public.yard_slots (company_id, code, zone, position, status)
      values (p_company_id, v_zone || v_pos::text, v_zone, v_pos, 'free')
      on conflict (company_id, code) do nothing;
      v_inserted := v_inserted + 1;
    end loop;
  end loop;
  return v_inserted;
end; $$;

grant execute on function public.yard_slots_seed_default(uuid) to authenticated;

-- Assign / release helpers (audited)
create or replace function public.yard_slot_assign(
  p_slot_id uuid,
  p_appointment_id uuid,
  p_truck_plate text default null,
  p_trailer_number text default null,
  p_driver_user_id uuid default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_company_id uuid;
begin
  select company_id into v_company_id from public.yard_slots where id = p_slot_id;
  if v_company_id is null then raise exception 'slot not found'; end if;
  if not (public.is_member_of(v_company_id) or public.is_admin()) then
    raise exception 'forbidden';
  end if;
  update public.yard_slots set
    status = 'occupied',
    current_appointment_id = p_appointment_id,
    current_truck_plate = coalesce(p_truck_plate, current_truck_plate),
    current_trailer_number = coalesce(p_trailer_number, current_trailer_number),
    driver_user_id = coalesce(p_driver_user_id, driver_user_id)
  where id = p_slot_id;

  perform public.write_audit('yard_slot_assigned', 'yard_slots', p_slot_id::text, null,
    jsonb_build_object('appointment_id', p_appointment_id, 'truck_plate', p_truck_plate), '');
end; $$;

grant execute on function public.yard_slot_assign(uuid, uuid, text, text, uuid) to authenticated;

create or replace function public.yard_slot_release(p_slot_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_company_id uuid;
begin
  select company_id into v_company_id from public.yard_slots where id = p_slot_id;
  if v_company_id is null then raise exception 'slot not found'; end if;
  if not (public.is_member_of(v_company_id) or public.is_admin()) then
    raise exception 'forbidden';
  end if;
  update public.yard_slots set
    status = 'free',
    current_appointment_id = null,
    current_truck_plate = null,
    current_trailer_number = null,
    driver_user_id = null
  where id = p_slot_id;
  perform public.write_audit('yard_slot_released', 'yard_slots', p_slot_id::text, null, '{}'::jsonb, '');
end; $$;

grant execute on function public.yard_slot_release(uuid) to authenticated;
