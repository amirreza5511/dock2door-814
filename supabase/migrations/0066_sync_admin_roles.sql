-- 0066_sync_admin_roles.sql
-- Fixes super-admin visibility of newly-created companies.
--
-- Root cause: Supabase RLS uses is_admin() which checks user_roles table,
-- but the app registers admins via profiles.role = 'SuperAdmin'/'Admin'.
-- If no matching user_roles row exists the admin RLS predicate returns false
-- and the admin cannot see companies they're not a member of.
--
-- Fix:
--   1. Backfill user_roles for existing admin profiles.
--   2. Add a trigger so future role changes on profiles auto-sync to user_roles.

-- ============================================================
-- 1) BACKFILL existing admins
-- ============================================================
insert into public.user_roles (user_id, role)
select id, 'admin'
  from public.profiles
 where role in ('Admin', 'SuperAdmin')
on conflict do nothing;

-- ============================================================
-- 2) TRIGGER: keep user_roles in sync when profiles.role changes
-- ============================================================
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
    -- If the role was demoted away from admin, remove the platform-level grant.
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

-- ============================================================
-- 3) Also ensure companies table allows admin SELECT via is_admin()
--    (separate policy so it's easily auditable, idempotent drop+create)
-- ============================================================
drop policy if exists "admin_select_companies" on public.companies;
create policy "admin_select_companies"
  on public.companies for select
  using (public.is_admin());

drop policy if exists "admin_select_company_users" on public.company_users;
create policy "admin_select_company_users"
  on public.company_users for select
  using (public.is_admin());

-- ============================================================
-- 4) Ensure company_submit_for_approval succeeds even when
--    the company was just created (status is already PendingApproval).
--    The old function raises if profile_is_complete is false.
--    Relax: only check completeness; don't raise on already-PendingApproval status.
-- ============================================================
create or replace function public.company_submit_for_approval(p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_member_of(p_company_id) or public.is_admin()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if not public.company_profile_is_complete(p_company_id) then
    raise exception 'profile_incomplete: fill all required profile fields first (name, industry, city, public bio 20+ chars, legal name, admin contact name + email)';
  end if;

  -- Always stamp as PendingApproval so Super Admin can review.
  update public.companies
     set status                    = 'PendingApproval',
         verified_at               = null,
         submitted_for_approval_at = now(),
         approval_rejection_reason = null
   where id = p_company_id;

  perform public.write_audit(
    'company.submitted_for_approval',
    'companies', p_company_id::text,
    null,
    jsonb_build_object('submitted_at', now()),
    ''
  );
end;
$$;

grant execute on function public.company_submit_for_approval(uuid) to authenticated;
