-- 0033_admin_role_sync.sql
-- Fixes the admin role gap introduced by split role storage:
--   profiles.role  stores 'Admin' / 'SuperAdmin'  (title-case, legacy display)
--   user_roles.role stores 'admin'                (lowercase, used by is_admin())
--
-- Migration 0003 seeded user_roles from profiles on first run, but any admin
-- created AFTER 0003 ran only has profiles.role — no user_roles row — so
-- is_admin() returns false for them and every admin-gated RLS policy blocks them.
--
-- This migration:
--   1. Backfills missing user_roles rows for all current Admin / SuperAdmin users
--   2. Adds a trigger that keeps user_roles in sync whenever profiles.role changes
--   3. Adds a trigger that removes user_roles when a profile is deleted
--
-- Fully idempotent — safe to run on any database state.

-- =========================================================================
-- 1) Backfill: insert user_roles 'admin' row for every profiles.role Admin/SuperAdmin
--    that does not already have one
-- =========================================================================
insert into public.user_roles (user_id, role)
select p.id, 'admin'
from public.profiles p
where p.role in ('Admin', 'SuperAdmin')
  and not exists (
    select 1 from public.user_roles ur
    where ur.user_id = p.id and ur.role = 'admin'
  )
on conflict (user_id, role) do nothing;

-- =========================================================================
-- 2) Trigger function: sync profiles.role → user_roles on INSERT or UPDATE
--    When role is set to Admin/SuperAdmin → ensure user_roles row exists
--    When role is changed away from Admin/SuperAdmin → remove user_roles row
--    Also handles INSERT so a new profile with role Admin/SuperAdmin is synced immediately
-- =========================================================================
create or replace function public.sync_admin_role_from_profile()
returns trigger language plpgsql security definer
set search_path = public
as $$
begin
  -- Gained admin/superadmin status (covers INSERT with role already set, and UPDATE that promotes)
  if NEW.role in ('Admin', 'SuperAdmin') then
    insert into public.user_roles (user_id, role)
    values (NEW.id, 'admin')
    on conflict (user_id, role) do nothing;

  -- Lost admin/superadmin status (UPDATE only: was Admin/SuperAdmin, now is not)
  -- On INSERT, OLD is null, so TG_OP guard is required
  elsif TG_OP = 'UPDATE'
    and OLD.role in ('Admin', 'SuperAdmin')
    and NEW.role not in ('Admin', 'SuperAdmin')
  then
    delete from public.user_roles
    where user_id = NEW.id and role = 'admin';
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_sync_admin_role on public.profiles;
create trigger trg_sync_admin_role
  after insert or update of role on public.profiles
  for each row
  execute function public.sync_admin_role_from_profile();

-- =========================================================================
-- 3) Trigger function: remove user_roles admin row when profile is deleted
-- =========================================================================
create or replace function public.remove_admin_role_on_profile_delete()
returns trigger language plpgsql security definer
set search_path = public
as $$
begin
  delete from public.user_roles
  where user_id = OLD.id and role = 'admin';
  return OLD;
end;
$$;

drop trigger if exists trg_remove_admin_role_on_delete on public.profiles;
create trigger trg_remove_admin_role_on_delete
  after delete on public.profiles
  for each row
  execute function public.remove_admin_role_on_profile_delete();

-- =========================================================================
-- 4) Diagnostic helper: list users whose profile role does NOT match user_roles
--    Useful for manual verification after applying this migration.
--    Usage: SELECT * FROM public.admin_role_audit();
-- =========================================================================
create or replace function public.admin_role_audit()
returns table (
  user_id     uuid,
  profile_role text,
  has_user_roles_admin boolean
) language sql stable security definer set search_path = public as $$
  select
    p.id as user_id,
    p.role as profile_role,
    exists (
      select 1 from public.user_roles ur
      where ur.user_id = p.id and ur.role = 'admin'
    ) as has_user_roles_admin
  from public.profiles p
  where p.role in ('Admin', 'SuperAdmin')
  order by p.role, p.id;
$$;

grant execute on function public.admin_role_audit() to authenticated;
