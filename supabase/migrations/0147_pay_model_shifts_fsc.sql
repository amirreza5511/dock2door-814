-- Dock2Door — Driver pay model rework: shift clock, hourly pay, fuel surcharge
-- ==========================================================================
-- 1. Loads can now be settled Hourly (in addition to Percent / Flat). Hourly
--    driver pay is NOT per-load; it is computed from the driver's logged shift
--    hours for the settlement period × their hourly rate. A load's
--    driver_pay_type='Hourly' just records the chosen method + the rate snapshot.
-- 2. A simple shift time-clock: drivers tap Start / End shift. Each shift is a
--    row in driver_shifts with started_at / ended_at and computed minutes.
-- 3. Monthly Fuel Surcharge (FSC): each carrier company sets an FSC percent per
--    calendar month; it is applied to freight on bills / invoices / settlement.
-- Additive + idempotent. Works for both trucking and drayage carrier companies
-- (both are rows in public.companies and use public.loads / public.drivers).
-- ==========================================================================

-- --------------------------------------------------------------------------
-- 1. Hourly settlement support on loads
-- --------------------------------------------------------------------------
-- driver_pay_value holds the hourly RATE snapshot when pay type is 'Hourly'.
-- load_driver_pay stays per-load (Percent/Flat); Hourly returns 0 here because
-- hourly pay is period-based and summed at the driver level in settlement.
create or replace function public.load_driver_pay(p_pay_type text, p_pay_value numeric, p_net numeric)
returns numeric language sql immutable as $$
  select case
    when p_pay_type = 'Percent' then round(coalesce(p_net, 0) * coalesce(p_pay_value, 0) / 100.0, 2)
    when p_pay_type = 'Flat'    then coalesce(p_pay_value, 0)
    else 0
  end;
$$;

-- Allow 'Hourly' as a valid pay type.
create or replace function public.set_load_settlement(
  p_load_id uuid, p_pay_type text, p_pay_value numeric, p_fuel_cost numeric default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_load public.loads;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  select * into v_load from public.loads where id = p_load_id for update;
  if v_load is null then raise exception 'load not found'; end if;
  if not (
    (v_load.accepted_company_id is not null and public.is_member_of(v_load.accepted_company_id))
    or public.is_admin()
  ) then
    raise exception 'only the carrier company can set settlement' using errcode = '42501';
  end if;
  if p_pay_type is not null and p_pay_type not in ('Percent', 'Flat', 'Hourly') then
    raise exception 'invalid pay type';
  end if;
  update public.loads
    set driver_pay_type = p_pay_type,
        driver_pay_value = p_pay_value,
        fuel_cost = coalesce(p_fuel_cost, fuel_cost),
        updated_at = now()
    where id = p_load_id;
end;
$$;
grant execute on function public.set_load_settlement(uuid, text, numeric, numeric) to authenticated;

-- --------------------------------------------------------------------------
-- 2. Driver shift time-clock
-- --------------------------------------------------------------------------
create table if not exists public.driver_shifts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  driver_user_id uuid not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  minutes numeric,                         -- filled on end (or edited by dispatcher)
  note text,
  created_at timestamptz not null default now()
);
create index if not exists idx_driver_shifts_driver on public.driver_shifts(driver_user_id, started_at desc);
create index if not exists idx_driver_shifts_company on public.driver_shifts(company_id, started_at desc);

alter table public.driver_shifts enable row level security;

-- A driver reads their own shifts; a company member reads their company's shifts.
drop policy if exists "driver_shifts_read" on public.driver_shifts;
create policy "driver_shifts_read" on public.driver_shifts for select using (
  driver_user_id = auth.uid()
  or (company_id is not null and public.is_member_of(company_id))
  or public.is_admin()
);

drop policy if exists "driver_shifts_write_admin" on public.driver_shifts;
create policy "driver_shifts_write_admin" on public.driver_shifts for all using (public.is_admin()) with check (public.is_admin());

-- Driver starts a shift. If one is already open, returns it (idempotent).
create or replace function public.start_shift(p_company_id uuid default null)
returns public.driver_shifts language plpgsql security definer set search_path = public as $$
declare v_open public.driver_shifts; v_new public.driver_shifts; v_company uuid;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  select * into v_open from public.driver_shifts
    where driver_user_id = auth.uid() and ended_at is null
    order by started_at desc limit 1;
  if v_open.id is not null then return v_open; end if;
  -- Resolve company: explicit param, else the driver's profile company.
  v_company := p_company_id;
  if v_company is null then
    select company_id into v_company from public.profiles where id = auth.uid();
  end if;
  insert into public.driver_shifts (company_id, driver_user_id, started_at)
    values (v_company, auth.uid(), now())
    returning * into v_new;
  return v_new;
end;
$$;
grant execute on function public.start_shift(uuid) to authenticated;

-- Driver ends their open shift; stamps ended_at + minutes.
create or replace function public.end_shift()
returns public.driver_shifts language plpgsql security definer set search_path = public as $$
declare v_open public.driver_shifts;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  select * into v_open from public.driver_shifts
    where driver_user_id = auth.uid() and ended_at is null
    order by started_at desc limit 1;
  if v_open.id is null then raise exception 'no open shift'; end if;
  update public.driver_shifts
    set ended_at = now(),
        minutes = round(extract(epoch from (now() - started_at)) / 60.0)
    where id = v_open.id
    returning * into v_open;
  return v_open;
end;
$$;
grant execute on function public.end_shift() to authenticated;

-- Dispatcher adjusts a shift's minutes (hour correction). Company members only.
create or replace function public.set_shift_minutes(p_shift_id uuid, p_minutes numeric)
returns void language plpgsql security definer set search_path = public as $$
declare v_shift public.driver_shifts;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  select * into v_shift from public.driver_shifts where id = p_shift_id for update;
  if v_shift is null then raise exception 'shift not found'; end if;
  if not ((v_shift.company_id is not null and public.is_member_of(v_shift.company_id)) or public.is_admin()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.driver_shifts set minutes = p_minutes where id = p_shift_id;
end;
$$;
grant execute on function public.set_shift_minutes(uuid, numeric) to authenticated;

-- --------------------------------------------------------------------------
-- 3. Monthly Fuel Surcharge (FSC) per company
-- --------------------------------------------------------------------------
create table if not exists public.fuel_surcharges (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  month date not null,                     -- first day of the month
  percent numeric not null default 0,      -- percent of freight
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, month)
);
create index if not exists idx_fuel_surcharges_company on public.fuel_surcharges(company_id, month desc);

alter table public.fuel_surcharges enable row level security;

drop policy if exists "fuel_surcharges_read" on public.fuel_surcharges;
create policy "fuel_surcharges_read" on public.fuel_surcharges for select using (
  public.is_member_of(company_id) or public.is_admin()
);

drop policy if exists "fuel_surcharges_write_admin" on public.fuel_surcharges;
create policy "fuel_surcharges_write_admin" on public.fuel_surcharges for all using (public.is_admin()) with check (public.is_admin());

-- Company sets (upserts) the FSC percent for a given month.
create or replace function public.set_fuel_surcharge(p_month date, p_percent numeric)
returns public.fuel_surcharges language plpgsql security definer set search_path = public as $$
declare v_company uuid; v_row public.fuel_surcharges; v_month date;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  select company_id into v_company from public.profiles where id = auth.uid();
  if v_company is null then raise exception 'no company context' using errcode = '42501'; end if;
  if p_percent < 0 or p_percent > 100 then raise exception 'percent out of range'; end if;
  v_month := date_trunc('month', p_month)::date;
  insert into public.fuel_surcharges (company_id, month, percent)
    values (v_company, v_month, p_percent)
    on conflict (company_id, month)
    do update set percent = excluded.percent, updated_at = now()
    returning * into v_row;
  return v_row;
end;
$$;
grant execute on function public.set_fuel_surcharge(date, numeric) to authenticated;

notify pgrst, 'reload schema';
