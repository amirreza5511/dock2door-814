-- =========================================================================
-- 0106 — Fleet codes + driver self-registration
-- Idempotent.
--
-- Goal: every fleet company (TruckingCompany, DrayageCompany) gets a short,
-- unique, shareable "fleet code". A driver can self-register from the signup
-- screen and enter that code — the signup trigger then links the new driver
-- to the right company by creating a `drivers` fleet record wired to the
-- driver's auth user (so dispatch can assign moves & chat with them).
-- =========================================================================

-- 1) fleet_code column ------------------------------------------------------
alter table public.companies
  add column if not exists fleet_code text;

create unique index if not exists idx_companies_fleet_code
  on public.companies (fleet_code)
  where fleet_code is not null;

-- 2) code generator ---------------------------------------------------------
-- 6-char uppercase, no ambiguous chars (0/O, 1/I). Retries until unique.
create or replace function public.gen_fleet_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
  v_i int;
  v_exists boolean;
begin
  loop
    v_code := '';
    for v_i in 1..6 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;
    select exists(select 1 from public.companies where fleet_code = v_code) into v_exists;
    exit when not v_exists;
  end loop;
  return v_code;
end;
$$;

-- 3) auto-assign a fleet code to fleet companies on insert ------------------
create or replace function public.assign_fleet_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.fleet_code is null and new.type in ('TruckingCompany', 'DrayageCompany') then
    new.fleet_code := public.gen_fleet_code();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_assign_fleet_code on public.companies;
create trigger trg_assign_fleet_code
  before insert on public.companies
  for each row execute function public.assign_fleet_code();

-- 4) backfill existing fleet companies -------------------------------------
update public.companies
set fleet_code = public.gen_fleet_code()
where fleet_code is null
  and type in ('TruckingCompany', 'DrayageCompany');

-- 5) lookup a company by fleet code (used to validate codes in the UI) ------
create or replace function public.resolve_fleet_code(p_code text)
returns table (company_id uuid, company_name text, company_type text)
language sql
security definer
set search_path = public
as $$
  select id, name, type::text
  from public.companies
  where fleet_code = upper(trim(p_code))
  limit 1;
$$;

grant execute on function public.resolve_fleet_code(text) to anon, authenticated;

-- 6) join a fleet by code for an already-logged-in driver ------------------
-- Creates (or refreshes) a drivers fleet record linking this auth user to the
-- company, so dispatch sees them and can assign work / chat.
create or replace function public.join_fleet_by_code(p_code text)
returns table (company_id uuid, company_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_company_name text;
  v_me uuid := auth.uid();
  v_email text;
  v_name text;
  v_existing uuid;
begin
  if v_me is null then
    raise exception 'Not authenticated';
  end if;

  select id, name into v_company_id, v_company_name
  from public.companies
  where fleet_code = upper(trim(p_code))
  limit 1;

  if v_company_id is null then
    raise exception 'Invalid fleet code';
  end if;

  select email, name into v_email, v_name from public.profiles where id = v_me;

  -- Reuse an existing (possibly dispatcher-created) driver row matched by
  -- linked user id or email; otherwise create a fresh one.
  select id into v_existing
  from public.drivers
  where company_id = v_company_id
    and archived_at is null
    and ((data->>'userId') = v_me::text or lower(coalesce(data->>'email','')) = lower(coalesce(v_email,'')))
  limit 1;

  if v_existing is not null then
    update public.drivers
    set profile_id = v_me,
        data = coalesce(data, '{}'::jsonb) || jsonb_build_object('userId', v_me::text, 'email', v_email),
        updated_at = now()
    where id = v_existing;
  else
    insert into public.drivers (company_id, profile_id, name, phone, status, data)
    values (
      v_company_id, v_me, coalesce(nullif(v_name, ''), split_part(coalesce(v_email,''), '@', 1)), '',
      'Active',
      jsonb_build_object('userId', v_me::text, 'email', v_email, 'name', coalesce(v_name, ''), 'selfRegistered', true)
    );
  end if;

  return query select v_company_id, v_company_name;
end;
$$;

grant execute on function public.join_fleet_by_code(text) to authenticated;

-- 7) handle_new_user: link self-registering drivers to a fleet by code ------
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
  v_fleet_code text;
  v_fleet_company_id uuid;
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
  v_fleet_code := nullif(trim(new.raw_user_meta_data->>'fleet_code'), '');

  v_company_type := case v_role
    when 'Customer' then 'Customer'::company_type
    when 'WarehouseProvider' then 'WarehouseProvider'::company_type
    when 'ServiceProvider' then 'ServiceProvider'::company_type
    when 'Employer' then 'Employer'::company_type
    when 'TruckingCompany' then 'TruckingCompany'::company_type
    when 'GateStaff' then 'WarehouseProvider'::company_type
    when 'Shipper' then 'Shipper'::company_type
    when 'DrayageCompany' then 'DrayageCompany'::company_type
    when 'FreightForwarder' then 'FreightForwarder'::company_type
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

  -- Driver self-registration: if a fleet code was supplied, wire this driver
  -- into that company's fleet so dispatch can see & assign them. The driver's
  -- own profile stays company-less (they are not a company owner).
  if v_role = 'Driver' and v_fleet_code is not null then
    select id into v_fleet_company_id
    from public.companies
    where fleet_code = upper(v_fleet_code)
    limit 1;

    if v_fleet_company_id is not null then
      insert into public.drivers (company_id, profile_id, name, phone, status, data)
      values (
        v_fleet_company_id, new.id, v_name, '',
        'Active',
        jsonb_build_object('userId', new.id::text, 'email', new.email, 'name', v_name, 'selfRegistered', true)
      );
    end if;
  end if;

  return new;
end;
$$;
