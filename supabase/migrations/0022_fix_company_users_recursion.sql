-- 0022_fix_company_users_recursion.sql
-- Fix: "infinite recursion detected in policy for relation \"company_users\""
--
-- Root cause: the cu_read_members SELECT policy on public.company_users contains
--   exists (select 1 from public.company_users me where ...)
-- which causes Postgres to re-evaluate the same policy on the inner query,
-- recursing forever. This blew up the admin "Update Status" action on
-- companies because admin_set_company_status touches company_users via
-- triggers / FK reads.
--
-- Fix: replace the self-referencing predicate with the existing
-- public.is_member_of(company_id) SECURITY DEFINER helper, which runs with
-- definer privileges and bypasses RLS on company_users — no recursion.
-- Same treatment for the write policy (use public.is_owner_of).

begin;

-- Make sure helpers exist and are SECURITY DEFINER (idempotent re-create)
create or replace function public.is_member_of(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.company_users
    where company_id = p_company_id
      and user_id   = auth.uid()
      and status    = 'Active'
  );
$$;

create or replace function public.is_owner_of(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.company_users
    where company_id    = p_company_id
      and user_id       = auth.uid()
      and company_role  = 'Owner'
      and status        = 'Active'
  );
$$;

grant execute on function public.is_member_of(uuid) to authenticated;
grant execute on function public.is_owner_of(uuid)  to authenticated;

-- Drop ALL legacy / current policies on company_users so we start clean
drop policy if exists "company_users_self_read" on public.company_users;
drop policy if exists "cu_read_members"         on public.company_users;
drop policy if exists "cu_owner_write"          on public.company_users;
drop policy if exists "cu_self_read"            on public.company_users;
drop policy if exists "cu_admin_read"           on public.company_users;
drop policy if exists "cu_member_read"          on public.company_users;
drop policy if exists "cu_owner_all"            on public.company_users;
drop policy if exists "cu_admin_all"            on public.company_users;

alter table public.company_users enable row level security;

-- SELECT: admin, the row's own user, or a member of that company
-- (membership check goes through SECURITY DEFINER helper -> no recursion)
create policy "cu_self_read" on public.company_users
  for select
  using (
    user_id = auth.uid()
  );

create policy "cu_admin_read" on public.company_users
  for select
  using (
    public.is_admin()
  );

create policy "cu_member_read" on public.company_users
  for select
  using (
    public.is_member_of(company_id)
  );

-- WRITE: company owner or platform admin (helpers bypass RLS -> no recursion)
create policy "cu_owner_all" on public.company_users
  for all
  using (
    public.is_owner_of(company_id)
  )
  with check (
    public.is_owner_of(company_id)
  );

create policy "cu_admin_all" on public.company_users
  for all
  using (
    public.is_admin()
  )
  with check (
    public.is_admin()
  );

commit;
