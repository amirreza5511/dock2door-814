-- Block privileged self-registration.
--
-- ROOT CAUSE of "everyone can register super admin":
--   handle_new_user() (migration 0001) blindly cast
--   `raw_user_meta_data->>'role'` into the new profile. The signup screen also
--   listed 'SuperAdmin' as a public, self-selectable role. So anyone could pick
--   (or POST) role = 'SuperAdmin'/'Admin' at signup and the trigger would grant
--   it -- and 0033/0056 then auto-sync profiles.role Admin/SuperAdmin into
--   user_roles('admin'), giving real platform-wide power.
--
-- FIX (defense in depth, server-side):
--   Rewrite handle_new_user() so any attempt to self-assign a privileged role
--   (Admin / SuperAdmin) is silently downgraded to 'Customer'. Admin/SuperAdmin
--   may ONLY be granted afterwards by an existing admin via the audited
--   admin_grant_role / sync RPCs. The signup metadata is never trusted for
--   privilege escalation.

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
begin
  v_requested_role := new.raw_user_meta_data->>'role';

  -- Never trust signup metadata to grant platform-privileged roles.
  -- Anyone trying to self-register as Admin/SuperAdmin is downgraded to Customer.
  if v_requested_role in ('Admin', 'SuperAdmin') then
    v_role := 'Customer'::user_role;
    raise warning 'handle_new_user: blocked self-assignment of privileged role % for %', v_requested_role, new.email;
  else
    v_role := coalesce(v_requested_role::user_role, 'Customer'::user_role);
  end if;

  v_name := coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1));
  v_company_name := new.raw_user_meta_data->>'company_name';
  v_company_city := coalesce(new.raw_user_meta_data->>'city', 'Vancouver');

  -- map role -> company_type
  v_company_type := case v_role
    when 'Customer' then 'Customer'::company_type
    when 'WarehouseProvider' then 'WarehouseProvider'::company_type
    when 'ServiceProvider' then 'ServiceProvider'::company_type
    when 'Employer' then 'Employer'::company_type
    when 'TruckingCompany' then 'TruckingCompany'::company_type
    when 'GateStaff' then 'WarehouseProvider'::company_type
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

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
