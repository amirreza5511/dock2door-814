-- 0056_is_admin_hardening.sql
--
-- ROOT CAUSE: is_admin() only checks user_roles table.
-- Any SuperAdmin / Admin user created AFTER migration 0003 ran (or before
-- migration 0033's trigger was applied) has profiles.role = 'Admin' /
-- 'SuperAdmin' but NO row in user_roles.  Result: is_admin() returns false →
-- RLS blocks ALL reads of worker_certifications, ALL admin RPCs fail with
-- "Admin privilege required".
--
-- FIX STRATEGY:
--   1. Rewrite is_admin() to check BOTH user_roles AND profiles.role directly
--      (profiles.role check is the reliable fallback).
--   2. Re-backfill user_roles for every current Admin / SuperAdmin.
--   3. Ensure the sync trigger from 0033 exists (idempotent re-create).
--
-- Fully idempotent — safe to run on any database state.

-- =========================================================================
-- 1) Rewrite is_admin() — check user_roles OR profiles.role
-- =========================================================================
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select
    -- Primary: has an explicit admin row in user_roles
    exists (
      select 1 from public.user_roles
      where user_id = auth.uid() and role = 'admin'
    )
    or
    -- Fallback: profile role is Admin or SuperAdmin (catches users whose
    -- user_roles row is missing because they were created before 0033 ran)
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('Admin', 'SuperAdmin')
    );
$$;

-- Re-grant (idempotent) so the new definition is callable
grant execute on function public.is_admin() to authenticated;

-- =========================================================================
-- 2) Re-backfill user_roles for all current Admin / SuperAdmin profiles
-- =========================================================================
insert into public.user_roles (user_id, role)
select p.id, 'admin'::platform_role
from public.profiles p
where p.role in ('Admin', 'SuperAdmin')
  and not exists (
    select 1 from public.user_roles ur
    where ur.user_id = p.id and ur.role = 'admin'
  )
on conflict (user_id, role) do nothing;

-- =========================================================================
-- 3) Re-ensure sync trigger (idempotent — same logic as 0033)
--    Keeps user_roles in sync whenever profiles.role changes
-- =========================================================================
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

-- =========================================================================
-- 4) Add a dedicated RLS policy on worker_certifications for profiles.role
--    (belt-and-suspenders: even if user_roles is empty, admin can still read)
-- =========================================================================
drop policy if exists "wc_profile_admin_read" on public.worker_certifications;
create policy "wc_profile_admin_read" on public.worker_certifications
  for select using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('Admin', 'SuperAdmin')
    )
  );

drop policy if exists "wc_profile_admin_write" on public.worker_certifications;
create policy "wc_profile_admin_write" on public.worker_certifications
  for all using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('Admin', 'SuperAdmin')
    )
  ) with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('Admin', 'SuperAdmin')
    )
  );

-- =========================================================================
-- 5) Diagnostic helper — run SELECT * FROM public.admin_role_audit()
--    to verify which admins have / are missing user_roles rows
-- =========================================================================
create or replace function public.admin_role_audit()
returns table (
  user_id            uuid,
  profile_role       text,
  has_user_roles_row boolean,
  is_admin_result    boolean
) language sql stable security definer set search_path = public as $$
  select
    p.id                                                            as user_id,
    p.role                                                          as profile_role,
    exists (
      select 1 from public.user_roles ur
      where ur.user_id = p.id and ur.role = 'admin'
    )                                                               as has_user_roles_row,
    -- Simulates what is_admin() now returns for each user
    (
      exists (select 1 from public.user_roles ur where ur.user_id = p.id and ur.role = 'admin')
      or p.role in ('Admin', 'SuperAdmin')
    )                                                               as is_admin_result
  from public.profiles p
  where p.role in ('Admin', 'SuperAdmin')
  order by p.role, p.id;
$$;

grant execute on function public.admin_role_audit() to authenticated;
