-- Dock2Door — ownership model correction (session-based active company, strict admin)
-- Builds on 0001_init.sql (which already created companies, company_users, profiles).

-- =========================================================================
-- 1) Platform-level roles table (replaces profiles.role-as-admin)
-- =========================================================================
do $$ begin
  create type platform_role as enum ('admin', 'support', 'finance');
exception when duplicate_object then null; end $$;

create table if not exists public.user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role platform_role not null,
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

alter table public.user_roles enable row level security;

-- Seed: anyone who is already Admin/SuperAdmin in profiles becomes platform admin
insert into public.user_roles (user_id, role)
select id, 'admin'::platform_role from public.profiles
where role in ('Admin','SuperAdmin')
on conflict do nothing;

-- =========================================================================
-- 2) Helpers — rewritten to use user_roles and company_users
-- =========================================================================
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin');
$$;

create or replace function public.is_member_of(p_company_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.company_users
    where company_id = p_company_id
      and user_id = auth.uid()
      and status = 'Active'
  );
$$;

create or replace function public.my_companies()
returns setof uuid language sql stable security definer set search_path = public as $$
  select company_id from public.company_users
   where user_id = auth.uid() and status = 'Active';
$$;

create or replace function public.is_owner_of(p_company_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.company_users
    where company_id = p_company_id
      and user_id = auth.uid()
      and company_role = 'Owner'
      and status = 'Active'
  );
$$;

-- Session-based active company via Postgres GUC
create or replace function public.set_active_company(p_company_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_company_id is null then
    perform set_config('request.active_company_id', '', true);
    return;
  end if;
  if not public.is_member_of(p_company_id) and not public.is_admin() then
    raise exception 'Not a member of company %', p_company_id using errcode = '42501';
  end if;
  perform set_config('request.active_company_id', p_company_id::text, true);
end;
$$;
grant execute on function public.set_active_company(uuid) to authenticated;

create or replace function public.active_company()
returns uuid language sql stable as $$
  select nullif(current_setting('request.active_company_id', true), '')::uuid;
$$;

-- Back-compat: keep my_company_id() for 0001/0002 policies. It now returns the
-- GUC-selected company if set, else the first active membership.
create or replace function public.my_company_id()
returns uuid language sql stable security definer set search_path = public as $func$
  select coalesce(
    public.active_company(),
    (select company_id from public.company_users
       where user_id = auth.uid() and status = 'Active'
       order by company_role <> 'Owner', company_id
       limit 1)
  );
$func$;

grant execute on function public.my_company_id() to authenticated;
grant execute on function public.active_company() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_member_of(uuid) to authenticated;
grant execute on function public.is_owner_of(uuid) to authenticated;
grant execute on function public.my_companies() to authenticated;

-- =========================================================================
-- 3) user_roles RLS — users read own roles, admin reads all, admin writes only
-- =========================================================================
drop policy if exists "ur_self_read" on public.user_roles;
create policy "ur_self_read" on public.user_roles for select
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "ur_admin_write" on public.user_roles;
create policy "ur_admin_write" on public.user_roles for all
  using (public.is_admin()) with check (public.is_admin());

-- =========================================================================
-- 4) company_users — needs membership visibility for helpers (SELECT)
--    owners can manage members of their own company
-- =========================================================================
drop policy if exists "company_users_self_read" on public.company_users;
create policy "cu_read_members" on public.company_users for select
  using (
    public.is_admin()
    or user_id = auth.uid()
    or exists (
      select 1 from public.company_users me
      where me.company_id = company_users.company_id
        and me.user_id = auth.uid()
        and me.status = 'Active'
    )
  );

drop policy if exists "cu_owner_write" on public.company_users;
create policy "cu_owner_write" on public.company_users for all
  using (public.is_admin() or public.is_owner_of(company_id))
  with check (public.is_admin() or public.is_owner_of(company_id));

-- =========================================================================
-- 5) Audit logs table — ensure it exists with the required shape
--    (0002 already creates audit_logs; this just adds missing columns.)
-- =========================================================================
alter table public.audit_logs
  add column if not exists entity_type text,
  add column if not exists reason text,
  add column if not exists ip text,
  add column if not exists user_agent text;

-- Backfill entity_type from legacy entity column if empty
update public.audit_logs
   set entity_type = entity
 where entity_type is null and entity is not null;

-- =========================================================================
-- 6) Drop legacy admin boolean ideas — profiles.role stays for display but
--    is no longer a security boundary. No-op here; documented.
-- =========================================================================
