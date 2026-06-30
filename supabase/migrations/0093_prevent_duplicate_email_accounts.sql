-- Prevent duplicate accounts for the same email.
--
-- ROOT CAUSE of "one email created two worker accounts (two war1)":
--   The `profiles` table never enforced email uniqueness, and handle_new_user()
--   blindly inserted a new profile for every new auth.users row without checking
--   whether that email already had a profile. Combined with case differences and
--   the unconfirmed-signup flow, the same person could end up with two separate
--   profiles (e.g. two "war1" workers).
--
-- FIX (defense in depth, server-side):
--   1) Normalize all existing profile emails to lower(trim(email)).
--   2) Guard handle_new_user(): if a profile already exists for that (normalized)
--      email, raise an exception. Because this fires inside the auth.users insert
--      transaction, the duplicate signup is rolled back and the API returns an
--      error instead of silently creating a second account.
--   3) Add a unique index on lower(email) so duplicates are impossible even if a
--      future code path bypasses the trigger.

-- 1) Normalize existing emails (idempotent).
update public.profiles
set email = lower(trim(email))
where email is not null
  and email <> lower(trim(email));

-- 2) Recreate handle_new_user with a duplicate-email guard.
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
  v_email text;
  v_company_id uuid;
  v_company_name text;
  v_company_city text;
  v_company_type company_type;
begin
  v_email := lower(trim(new.email));

  -- Block a second profile for an email that already has one.
  if exists (
    select 1 from public.profiles p
    where lower(trim(p.email)) = v_email
      and p.id <> new.id
  ) then
    raise exception 'An account already exists for this email (%). Please sign in instead.', v_email
      using errcode = 'unique_violation';
  end if;

  v_requested_role := new.raw_user_meta_data->>'role';

  -- Never trust signup metadata to grant platform-privileged roles.
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
    else null
  end;

  if v_company_type is not null and coalesce(v_company_name, '') <> '' then
    insert into public.companies (name, type, city, status)
    values (v_company_name, v_company_type, v_company_city, 'PendingApproval')
    returning id into v_company_id;
  end if;

  insert into public.profiles (id, email, name, role, company_id)
  values (new.id, v_email, v_name, v_role, v_company_id);

  if v_company_id is not null then
    insert into public.company_users (company_id, user_id, company_role, status)
    values (v_company_id, new.id, 'Owner', 'Active');
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 3) Enforce uniqueness at the storage level too.
-- Only created when no duplicates remain; if duplicates still exist the index
-- creation is skipped so the migration stays safe to apply.
do $$
declare
  v_dupes int;
begin
  select count(*) into v_dupes from (
    select lower(trim(email)) as e
    from public.profiles
    where email is not null
    group by lower(trim(email))
    having count(*) > 1
  ) d;

  if v_dupes = 0 then
    create unique index if not exists idx_profiles_email_unique_ci
      on public.profiles (lower(trim(email)));
  else
    raise warning 'Skipping unique email index: % duplicate email group(s) still exist in profiles. Resolve them, then re-run.', v_dupes;
  end if;
end $$;
