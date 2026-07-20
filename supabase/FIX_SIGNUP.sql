-- ============================================================================
-- FIX_SIGNUP.sql — one-shot repair of the signup pipeline
-- ----------------------------------------------------------------------------
-- Run this WHOLE file in Supabase Dashboard → SQL Editor.
--
-- Remote diagnosis confirmed (2026-07-20):
--   • DB is writable (not read-only / quota OK)
--   • disable_signup = false, email provider on
--   • All tables & enum values handle_new_user needs EXIST live
--   • Even a metadata-free signup fails ⇒ the deployed trigger function
--     itself is broken/stale.
--
-- This file re-deploys the ENTIRE signup path from the known-good source
-- (migration 0156) and then SIMULATES a signup with rollback, printing the
-- real error (if any) as a NOTICE. Idempotent — safe to run multiple times.
-- ============================================================================

-- ─── 1) Known-good handle_new_user (verbatim from 0156_guest_access.sql) ────
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
  v_agent_code text;
  v_vertical text;
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
  v_agent_code := nullif(trim(new.raw_user_meta_data->>'agent_code'), '');

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
    when 'EquipmentRentalCompany' then 'EquipmentRentalCompany'::company_type
    when 'MobileRepairProvider' then 'MobileRepairProvider'::company_type
    when 'CargoInsurer' then 'CargoInsurer'::company_type
    when 'MarketplaceBuyer' then 'MarketplaceBuyer'::company_type
    when 'EmploymentAgency' then 'EmploymentAgency'::company_type
    when 'CustomsBroker' then 'CustomsBroker'::company_type
    else null
  end;

  if v_company_type is not null and coalesce(v_company_name, '') <> '' then
    insert into public.companies (name, type, city, status)
    values (v_company_name, v_company_type, v_company_city, 'PendingApproval')
    returning id into v_company_id;
  end if;

  -- Guest signup → auto-approved personal guest company.
  if v_role::text = 'Guest' then
    insert into public.companies (name, type, city, status, is_guest)
    values (
      coalesce(nullif(trim(coalesce(v_company_name, '')), ''), v_name || ' (Guest)'),
      'Customer'::company_type, v_company_city, 'Approved', true
    )
    returning id into v_company_id;
  end if;

  insert into public.profiles (id, email, name, role, company_id)
  values (new.id, new.email, v_name, v_role, v_company_id);

  if v_company_id is not null then
    insert into public.company_users (company_id, user_id, company_role, status)
    values (v_company_id, new.id, 'Owner', 'Active');
  end if;

  -- Sales agent self-registration → provision an agent record + code.
  if v_role = 'SalesAgent' then
    perform public.ensure_sales_agent(new.id);
  end if;

  -- Driver self-registration → link into the fleet as a PENDING request.
  if v_role = 'Driver' and v_fleet_code is not null then
    select id into v_fleet_company_id
    from public.companies where fleet_code = upper(v_fleet_code) limit 1;

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

  -- Worker self-registration → auto-link to agency roster invites.
  if v_role = 'Worker' then
    update public.agency_workers
       set worker_user_id = new.id, status = 'Active', updated_at = now()
     where worker_user_id is null
       and lower(email) = lower(new.email)
       and status = 'Invited';
  end if;

  -- Agent-code attribution.
  if v_agent_code is not null and v_role <> 'SalesAgent' then
    v_vertical := case v_role
      when 'WarehouseProvider' then 'warehouse'
      when 'DrayageCompany' then 'drayage'
      when 'FreightForwarder' then 'freight_forwarder'
      when 'CustomsBroker' then 'freight_forwarder'
      when 'Employer' then 'employer'
      when 'EmploymentAgency' then 'employer'
      when 'TruckingCompany' then 'trucking'
      when 'Shipper' then 'shipper'
      when 'Customer' then 'customer'
      when 'ServiceProvider' then 'service'
      when 'Worker' then 'worker'
      when 'Driver' then 'driver'
      when 'EquipmentRentalCompany' then 'service'
      when 'MobileRepairProvider' then 'service'
      when 'CargoInsurer' then 'service'
      when 'MarketplaceBuyer' then 'customer'
      else 'customer'
    end;
    begin
      perform public.attribute_account_to_agent(v_agent_code, new.id, v_company_id, v_vertical, 'code');
    exception when others then
      raise warning 'handle_new_user: agent attribution failed for %: %', new.email, sqlerrm;
    end;
  end if;

  -- Legal acceptances captured at signup.
  begin
    if coalesce(new.raw_user_meta_data->>'accepted_terms', '') = 'true' then
      insert into public.legal_acceptances (user_id, doc_type, doc_version, signed_name, role, platform)
      values (new.id, 'terms',
              coalesce(nullif(new.raw_user_meta_data->>'terms_version', ''), '1.0'),
              v_name, v_role::text, coalesce(new.raw_user_meta_data->>'signup_platform', ''))
      on conflict (user_id, doc_type) do nothing;
    end if;
    if coalesce(new.raw_user_meta_data->>'accepted_nda', '') = 'true' then
      insert into public.legal_acceptances (user_id, doc_type, doc_version, signed_name, role, platform)
      values (new.id, 'nda',
              coalesce(nullif(new.raw_user_meta_data->>'nda_version', ''), '1.0'),
              coalesce(nullif(new.raw_user_meta_data->>'nda_signed_name', ''), v_name),
              v_role::text, coalesce(new.raw_user_meta_data->>'signup_platform', ''))
      on conflict (user_id, doc_type) do nothing;
    end if;
  exception when others then
    raise warning 'handle_new_user: legal acceptance recording failed for %: %', new.email, sqlerrm;
  end;

  return new;
end;
$$;

-- ─── 2) Re-assert the trigger on auth.users ─────────────────────────────────
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─── 3) Re-assert the profile→user_roles sync functions + triggers ──────────
create or replace function public.sync_profile_role_to_user_roles()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.role in ('Admin', 'SuperAdmin') then
    insert into public.user_roles (user_id, role)
    values (NEW.id, 'admin')
    on conflict do nothing;
  else
    delete from public.user_roles
     where user_id = NEW.id
       and role = 'admin';
  end if;
  return NEW;
end;
$$;

drop trigger if exists tr_sync_profile_role on public.profiles;
create trigger tr_sync_profile_role
  after insert or update of role on public.profiles
  for each row
  execute function public.sync_profile_role_to_user_roles();

create or replace function public.sync_admin_role_from_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.role in ('Admin', 'SuperAdmin') then
    insert into public.user_roles (user_id, role)
    values (NEW.id, 'admin')
    on conflict (user_id, role) do nothing;
  elsif TG_OP = 'UPDATE'
    and OLD.role in ('Admin', 'SuperAdmin')
    and NEW.role not in ('Admin', 'SuperAdmin')
  then
    delete from public.user_roles where user_id = NEW.id and role = 'admin';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_sync_admin_role on public.profiles;
create trigger trg_sync_admin_role
  after insert or update of role on public.profiles
  for each row
  execute function public.sync_admin_role_from_profile();

-- ─── 4) Belt-and-suspenders permissions for the auth service role ───────────
grant usage on schema public to supabase_auth_admin;
grant execute on function public.handle_new_user() to supabase_auth_admin;

-- ─── 5) SELF-TEST: simulate a real signup, then roll it back ─────────────────
-- Prints SIGNUP TEST: OK  — or —  SIGNUP TEST FAILED with the real error.
do $$
declare
  v_uid uuid := gen_random_uuid();
begin
  begin
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at
    ) values (
      '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
      'fix_selftest_' || replace(v_uid::text, '-', '') || '@example.com',
      crypt('Test123456!', gen_salt('bf')),
      now(), '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object(
        'role', 'CustomsBroker',
        'name', 'Self Test',
        'company_name', 'Self Test Brokerage',
        'city', 'Vancouver',
        'accepted_terms', 'true', 'terms_version', '1.0',
        'accepted_nda', 'true', 'nda_version', '1.0',
        'nda_signed_name', 'Self Test', 'signup_platform', 'sql-selftest'
      ),
      now(), now()
    );
    raise exception 'DIAG_ROLLBACK';
  exception
    when others then
      if sqlerrm = 'DIAG_ROLLBACK' then
        raise notice '=== SIGNUP TEST: OK — signup pipeline works. ===';
      else
        raise notice '=== SIGNUP TEST FAILED — real error: % (SQLSTATE %) ===', sqlerrm, sqlstate;
      end if;
  end;
end;
$$;

-- ─── 6) Refresh PostgREST schema cache ───────────────────────────────────────
notify pgrst, 'reload schema';
