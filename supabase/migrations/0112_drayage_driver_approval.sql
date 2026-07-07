-- =========================================================================
-- 0112 — Drayage driver join-requests need dispatch approval
-- Idempotent.
--
-- Problem: when a driver joins a fleet by code (join_fleet_by_code) they were
-- inserted as an 'Active' driver immediately, and dispatch had NO place to see
-- or approve them. This makes self-registration a request that a drayage
-- company must approve before the driver can be dispatched.
--
-- Rules:
--   * A driver who self-joins by code lands as 'PendingApproval'.
--   * A driver a dispatcher pre-created (or who was already Active) is NOT
--     downgraded — only fresh self-join rows are pending.
--   * Only Active drivers can be assigned moves (enforced in the UI/backend).
--   * approve_fleet_driver() lets a fleet company member approve (-> Active)
--     or reject (-> archived) a pending driver.
-- =========================================================================

-- 1) Recreate join_fleet_by_code so fresh self-join rows are PendingApproval.
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
  -- linked user id or email; otherwise create a fresh pending one.
  select id into v_existing
  from public.drivers
  where company_id = v_company_id
    and archived_at is null
    and ((data->>'userId') = v_me::text or lower(coalesce(data->>'email','')) = lower(coalesce(v_email,'')))
  limit 1;

  if v_existing is not null then
    -- Existing row: link the account but keep its current status (a dispatcher
    -- who pre-created the driver already trusts them).
    update public.drivers
    set profile_id = v_me,
        data = coalesce(data, '{}'::jsonb) || jsonb_build_object('userId', v_me::text, 'email', v_email),
        updated_at = now()
    where id = v_existing;
  else
    -- Fresh self-join → needs dispatch approval before being dispatchable.
    insert into public.drivers (company_id, profile_id, name, phone, status, data)
    values (
      v_company_id, v_me, coalesce(nullif(v_name, ''), split_part(coalesce(v_email,''), '@', 1)), '',
      'PendingApproval',
      jsonb_build_object('userId', v_me::text, 'email', v_email, 'name', coalesce(v_name, ''), 'selfRegistered', true)
    );

    -- Notify every member of the fleet company that a driver wants to join.
    insert into public.notifications (user_id, kind, title, body, entity_type, entity_id)
    select cu.user_id, 'system', 'Driver wants to join your fleet',
      coalesce(nullif(v_name, ''), coalesce(v_email, 'A driver')) || ' requested to join. Approve them in Dispatch.',
      'drivers', v_company_id
    from public.company_users cu
    where cu.company_id = v_company_id and cu.status = 'Active';
  end if;

  return query select v_company_id, v_company_name;
end;
$$;

grant execute on function public.join_fleet_by_code(text) to authenticated;

-- 2) Self-registration at signup also lands as PendingApproval.
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

  -- Driver self-registration: link into the fleet as a PENDING request that
  -- dispatch must approve before the driver can be dispatched.
  if v_role = 'Driver' and v_fleet_code is not null then
    select id into v_fleet_company_id
    from public.companies
    where fleet_code = upper(v_fleet_code)
    limit 1;

    if v_fleet_company_id is not null then
      insert into public.drivers (company_id, profile_id, name, phone, status, data)
      values (
        v_fleet_company_id, new.id, v_name, '',
        'PendingApproval',
        jsonb_build_object('userId', new.id::text, 'email', new.email, 'name', v_name, 'selfRegistered', true)
      );

      insert into public.notifications (user_id, kind, title, body, entity_type, entity_id)
      select cu.user_id, 'system', 'Driver wants to join your fleet',
        v_name || ' requested to join. Approve them in Dispatch.',
        'drivers', v_fleet_company_id
      from public.company_users cu
      where cu.company_id = v_fleet_company_id and cu.status = 'Active';
    end if;
  end if;

  return new;
end;
$$;

-- 3) Approve or reject a pending driver (fleet company member or admin only).
create or replace function public.approve_fleet_driver(p_driver_id uuid, p_approve boolean default true)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_profile_id uuid;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;

  select company_id, profile_id into v_company_id, v_profile_id
  from public.drivers where id = p_driver_id;
  if v_company_id is null then raise exception 'driver not found'; end if;

  if not (public.is_member_of(v_company_id) or public.is_admin()) then
    raise exception 'only the fleet company can approve drivers' using errcode = '42501';
  end if;

  if p_approve then
    update public.drivers set status = 'Active', updated_at = now() where id = p_driver_id;
    if v_profile_id is not null then
      insert into public.notifications (user_id, kind, title, body, entity_type, entity_id)
      values (v_profile_id, 'system', 'Fleet access approved',
        'You have been approved and can now receive drayage work orders.', 'drivers', p_driver_id);
    end if;
  else
    update public.drivers set archived_at = now(), status = 'Inactive', updated_at = now() where id = p_driver_id;
    if v_profile_id is not null then
      insert into public.notifications (user_id, kind, title, body, entity_type, entity_id)
      values (v_profile_id, 'system', 'Fleet request declined',
        'Your request to join the fleet was declined. Contact the company for details.', 'drivers', p_driver_id);
    end if;
  end if;
end;
$$;

grant execute on function public.approve_fleet_driver(uuid, boolean) to authenticated;

-- 4) Refresh PostgREST schema cache.
notify pgrst, 'reload schema';
