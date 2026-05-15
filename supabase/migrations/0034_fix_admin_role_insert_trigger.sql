-- 0034_fix_admin_role_insert_trigger.sql
-- Fixes migration 0033: the trigger was created as AFTER UPDATE only,
-- so new profiles inserted with role Admin/SuperAdmin never got a user_roles row.
-- This migration re-creates the trigger function (handles TG_OP = 'INSERT' correctly
-- by guarding the OLD reference) and re-creates the trigger as AFTER INSERT OR UPDATE OF role.
-- Fully idempotent — safe to run on any state (including databases where 0033 already ran).

-- =========================================================================
-- 1) Replace trigger function — safe for both INSERT and UPDATE
-- =========================================================================
create or replace function public.sync_admin_role_from_profile()
returns trigger language plpgsql security definer
set search_path = public
as $$
begin
  -- Promoted to Admin/SuperAdmin (covers fresh INSERT and UPDATE promotions)
  if NEW.role in ('Admin', 'SuperAdmin') then
    insert into public.user_roles (user_id, role)
    values (NEW.id, 'admin')
    on conflict (user_id, role) do nothing;

  -- Demoted away from Admin/SuperAdmin — only possible on UPDATE (OLD exists)
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

-- =========================================================================
-- 2) Re-create trigger as AFTER INSERT OR UPDATE OF role
-- =========================================================================
drop trigger if exists trg_sync_admin_role on public.profiles;

create trigger trg_sync_admin_role
  after insert or update of role on public.profiles
  for each row
  execute function public.sync_admin_role_from_profile();

-- =========================================================================
-- 3) Backfill — catch any Admin/SuperAdmin profiles that slipped through
--    between when 0033 was applied and now (e.g. profiles inserted after
--    0033 ran, before this migration was applied).
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
