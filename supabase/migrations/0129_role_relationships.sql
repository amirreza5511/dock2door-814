-- ============================================================================
-- 0129_role_relationships.sql
-- Multi-role businesses + partner connections directory.
--
-- Adds:
--   * company_roles          — every approved role a company holds (seeded from companies.type)
--   * company_role_requests  — a business asking to add a compatible role (admin-approved)
--   * company_connections    — partner connection requests between compatible companies
--   * relationship helpers   — role_works_with(), role_addable(), company_held_roles()
--   * RPCs                    — request/approve roles, send/respond connections, directory
--   * RLS                     — members read their own company rows, admins read all
--
-- Idempotent. Mirrors expo/lib/relationships.ts and apps/web/lib/relationships.ts.
-- ============================================================================

-- ─── 1) Ensure every business company_type exists as a user_role value ───────
-- (Shipper/DrayageCompany/FreightForwarder already added in earlier migrations;
--  guard anyway so this file is self-contained.)
do $$ begin alter type user_role add value if not exists 'Shipper'; exception when others then null; end $$;
do $$ begin alter type user_role add value if not exists 'DrayageCompany'; exception when others then null; end $$;
do $$ begin alter type user_role add value if not exists 'FreightForwarder'; exception when others then null; end $$;
commit;

-- ─── 2) Tables ───────────────────────────────────────────────────────────────

create table if not exists public.company_roles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  role user_role not null,
  status active_status not null default 'Active',
  granted_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (company_id, role)
);
create index if not exists idx_company_roles_company on public.company_roles(company_id);

create table if not exists public.company_role_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  requested_role user_role not null,
  status text not null default 'Pending', -- Pending | Approved | Rejected
  note text default '',
  requested_by uuid references public.profiles(id),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now()
);
create index if not exists idx_role_requests_company on public.company_role_requests(company_id);
create index if not exists idx_role_requests_status on public.company_role_requests(status);

create table if not exists public.company_connections (
  id uuid primary key default gen_random_uuid(),
  requester_company_id uuid not null references public.companies(id) on delete cascade,
  target_company_id uuid not null references public.companies(id) on delete cascade,
  status text not null default 'Pending', -- Pending | Accepted | Declined
  note text default '',
  requested_by uuid references public.profiles(id),
  responded_by uuid references public.profiles(id),
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  check (requester_company_id <> target_company_id),
  unique (requester_company_id, target_company_id)
);
create index if not exists idx_connections_requester on public.company_connections(requester_company_id);
create index if not exists idx_connections_target on public.company_connections(target_company_id);

-- ─── 3) Seed company_roles from the existing single company type ──────────────
insert into public.company_roles (company_id, role)
select c.id, c.type::text::user_role
  from public.companies c
 where not exists (
   select 1 from public.company_roles cr where cr.company_id = c.id and cr.role = c.type::text::user_role
 )
on conflict (company_id, role) do nothing;

-- ─── 4) Relationship definition (kept in sync with the TS mirrors) ────────────

create or replace function public.role_works_with(p_role text)
returns text[] language sql immutable as $$
  select case p_role
    when 'Employer'          then array['Worker','Customer','WarehouseProvider','ServiceProvider']
    when 'Customer'          then array['WarehouseProvider','ServiceProvider','Shipper','FreightForwarder','Employer','TruckingCompany']
    when 'WarehouseProvider' then array['Customer','ServiceProvider','TruckingCompany','Employer']
    when 'ServiceProvider'   then array['Customer','WarehouseProvider']
    when 'Shipper'           then array['TruckingCompany','Customer','FreightForwarder']
    when 'TruckingCompany'   then array['Shipper','Customer','WarehouseProvider','DrayageCompany']
    when 'FreightForwarder'  then array['DrayageCompany','Customer','Shipper']
    when 'DrayageCompany'    then array['FreightForwarder','TruckingCompany','Customer']
    when 'Worker'            then array['Employer']
    else array[]::text[]
  end;
$$;

create or replace function public.role_addable(p_role text)
returns text[] language sql immutable as $$
  select case p_role
    when 'Customer'          then array['Employer','Shipper','FreightForwarder']
    when 'WarehouseProvider' then array['Customer','Employer','ServiceProvider']
    when 'ServiceProvider'   then array['Customer','Employer']
    when 'Employer'          then array['Customer','WarehouseProvider']
    when 'TruckingCompany'   then array['Customer','Shipper','DrayageCompany']
    when 'Shipper'           then array['Customer','FreightForwarder']
    when 'DrayageCompany'    then array['Customer','TruckingCompany','FreightForwarder']
    when 'FreightForwarder'  then array['Customer','DrayageCompany']
    else array[]::text[]
  end;
$$;

-- Every role a company currently holds (primary type + granted extra roles).
create or replace function public.company_held_roles(p_company_id uuid)
returns text[] language sql stable security definer set search_path = public as $$
  select array(
    select distinct r from (
      select c.type::text as r from public.companies c where c.id = p_company_id
      union
      select cr.role::text from public.company_roles cr
        where cr.company_id = p_company_id and cr.status = 'Active'
    ) t
  );
$$;

-- Roles a company is still allowed to add (addable minus already held).
create or replace function public.company_addable_roles(p_company_id uuid)
returns text[] language sql stable security definer set search_path = public as $$
  with held as (select public.company_held_roles(p_company_id) as roles),
  candidates as (
    select distinct unnest(public.role_addable(r)) as role
      from unnest((select roles from held)) r
  )
  select coalesce(array_agg(c.role), array[]::text[])
    from candidates c
   where not (c.role = any((select roles from held)));
$$;

grant execute on function public.role_works_with(text) to authenticated;
grant execute on function public.role_addable(text) to authenticated;
grant execute on function public.company_held_roles(uuid) to authenticated;
grant execute on function public.company_addable_roles(uuid) to authenticated;

-- ─── 5) RLS ───────────────────────────────────────────────────────────────────

alter table public.company_roles enable row level security;
alter table public.company_role_requests enable row level security;
alter table public.company_connections enable row level security;

drop policy if exists cr_read on public.company_roles;
create policy cr_read on public.company_roles
  for select to authenticated
  using (public.is_admin() or public.is_member_of(company_id));

drop policy if exists rr_read on public.company_role_requests;
create policy rr_read on public.company_role_requests
  for select to authenticated
  using (public.is_admin() or public.is_member_of(company_id));

drop policy if exists conn_read on public.company_connections;
create policy conn_read on public.company_connections
  for select to authenticated
  using (
    public.is_admin()
    or public.is_member_of(requester_company_id)
    or public.is_member_of(target_company_id)
  );

-- ─── 6) Role request + approval RPCs ──────────────────────────────────────────

-- A business owner asks to add a compatible role. Lands in the admin queue.
create or replace function public.request_company_role(
  p_company_id uuid,
  p_role text,
  p_note text default ''
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_role user_role;
  v_id uuid;
  v_name text;
  v_admin uuid;
begin
  if not public.is_owner_of(p_company_id) and not public.is_admin() then
    raise exception 'Only the company owner can add a role' using errcode = '42501';
  end if;
  begin v_role := p_role::user_role; exception when others then
    raise exception 'Invalid role: %', p_role using errcode = '22023';
  end;

  -- Server-side compatibility gate — mirror of ADDABLE_ROLES.
  if not (p_role = any(public.company_addable_roles(p_company_id))) then
    raise exception 'Role % is not compatible with this business', p_role using errcode = '22023';
  end if;

  -- Block duplicate pending requests.
  if exists (
    select 1 from public.company_role_requests
     where company_id = p_company_id and requested_role = v_role and status = 'Pending'
  ) then
    raise exception 'A request for this role is already pending' using errcode = '23505';
  end if;

  insert into public.company_role_requests (company_id, requested_role, note, requested_by)
  values (p_company_id, v_role, coalesce(p_note,''), auth.uid())
  returning id into v_id;

  select name into v_name from public.companies where id = p_company_id;
  perform public.write_audit('role.request', 'company_role_requests', v_id::text,
    null, jsonb_build_object('company_id', p_company_id, 'role', p_role), p_note, p_company_id);

  -- Notify every platform admin (best-effort).
  for v_admin in select user_id from public.user_roles where role in ('admin','super_admin') loop
    perform public.queue_notification(v_admin, 'company_pending',
      'New role request',
      coalesce(v_name,'A company') || ' requested the ' || p_role || ' role.',
      'company_role_requests', v_id::text, jsonb_build_object('company_id', p_company_id, 'role', p_role));
  end loop;

  return v_id;
end;
$$;
grant execute on function public.request_company_role(uuid, text, text) to authenticated;

-- Admin approves or rejects a role request. Approval grants the role.
create or replace function public.admin_review_role_request(
  p_request_id uuid,
  p_approve boolean,
  p_reason text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_req public.company_role_requests%rowtype;
  v_owner uuid;
  v_name text;
begin
  if not public.is_admin() then
    raise exception 'Admin privilege required' using errcode = '42501';
  end if;
  select * into v_req from public.company_role_requests where id = p_request_id;
  if v_req.id is null then raise exception 'Request not found' using errcode = '22023'; end if;
  if v_req.status <> 'Pending' then raise exception 'Request already reviewed' using errcode = '22023'; end if;

  if not p_approve then
    perform public.require_reason(p_reason);
    update public.company_role_requests
       set status = 'Rejected', reviewed_by = auth.uid(), reviewed_at = now(), rejection_reason = p_reason
     where id = p_request_id;
  else
    update public.company_role_requests
       set status = 'Approved', reviewed_by = auth.uid(), reviewed_at = now()
     where id = p_request_id;
    insert into public.company_roles (company_id, role, granted_by)
    values (v_req.company_id, v_req.requested_role, auth.uid())
    on conflict (company_id, role) do update set status = 'Active';
  end if;

  perform public.write_audit(
    case when p_approve then 'role.approve' else 'role.reject' end,
    'company_role_requests', p_request_id::text, null,
    jsonb_build_object('company_id', v_req.company_id, 'role', v_req.requested_role::text), p_reason, v_req.company_id);

  select name into v_name from public.companies where id = v_req.company_id;
  for v_owner in
    select user_id from public.company_users
     where company_id = v_req.company_id and company_role = 'Owner' and status = 'Active'
  loop
    perform public.queue_notification(v_owner, 'system',
      case when p_approve then 'Role approved ✅' else 'Role request declined' end,
      case when p_approve
        then 'Your business can now act as ' || v_req.requested_role::text || '. Switch roles from the top of your dashboard.'
        else 'Your request for the ' || v_req.requested_role::text || ' role was declined: ' || coalesce(p_reason,'') end,
      'companies', v_req.company_id::text, jsonb_build_object('role', v_req.requested_role::text));
  end loop;
end;
$$;
grant execute on function public.admin_review_role_request(uuid, boolean, text) to authenticated;

-- Admin queue: all pending role requests with company context.
create or replace function public.list_role_requests(p_status text default 'Pending')
returns table (
  id uuid, company_id uuid, company_name text, company_type text,
  requested_role text, note text, status text, created_at timestamptz,
  rejection_reason text
) language sql stable security definer set search_path = public as $$
  select rr.id, rr.company_id, c.name, c.type::text, rr.requested_role::text,
         rr.note, rr.status, rr.created_at, rr.rejection_reason
    from public.company_role_requests rr
    join public.companies c on c.id = rr.company_id
   where public.is_admin()
     and (p_status is null or rr.status = p_status)
   order by rr.created_at asc;
$$;
grant execute on function public.list_role_requests(text) to authenticated;

-- ─── 7) Partner connection RPCs ───────────────────────────────────────────────

-- Directory of compatible companies with connection status + rating.
create or replace function public.list_partner_companies(
  p_company_id uuid,
  p_role_filter text default null,
  p_search text default null
) returns table (
  company_id uuid, name text, city text, primary_type text,
  held_roles text[], rating numeric, review_count bigint,
  connection_id uuid, connection_status text, connection_direction text
) language plpgsql stable security definer set search_path = public as $$
declare
  v_viewer_roles text[];
  v_target_roles text[];
begin
  if not public.is_member_of(p_company_id) and not public.is_admin() then
    raise exception 'Not a member of this company' using errcode = '42501';
  end if;

  v_viewer_roles := public.company_held_roles(p_company_id);
  select array(
    select distinct t from (
      select unnest(public.role_works_with(r)) as t from unnest(v_viewer_roles) r
    ) x
    -- only business roles are shown in the directory (workers etc. aren't companies)
    where t in ('Customer','WarehouseProvider','ServiceProvider','Employer',
                'TruckingCompany','Shipper','FreightForwarder','DrayageCompany')
  ) into v_target_roles;

  if p_role_filter is not null and p_role_filter <> '' then
    v_target_roles := array(select unnest(v_target_roles) intersect select p_role_filter);
  end if;

  return query
  select c.id,
         c.name,
         c.city,
         c.type::text,
         public.company_held_roles(c.id),
         coalesce(round(avg(rv.rating)::numeric, 1), 0),
         count(rv.id),
         conn.id,
         conn.status,
         case when conn.id is null then null
              when conn.requester_company_id = p_company_id then 'outgoing'
              else 'incoming' end
    from public.companies c
    left join public.reviews rv on rv.target_id = c.id::text
    left join public.company_connections conn
      on (conn.requester_company_id = p_company_id and conn.target_company_id = c.id)
      or (conn.target_company_id = p_company_id and conn.requester_company_id = c.id)
   where c.id <> p_company_id
     and c.status = 'Approved'
     and (
       c.type::text = any(v_target_roles)
       or exists (
         select 1 from public.company_roles cr
          where cr.company_id = c.id and cr.status = 'Active' and cr.role::text = any(v_target_roles)
       )
     )
     and (p_search is null or p_search = '' or c.name ilike '%'||p_search||'%' or c.city ilike '%'||p_search||'%')
   group by c.id, c.name, c.city, c.type, conn.id, conn.status, conn.requester_company_id, conn.target_company_id
   order by c.name asc;
end;
$$;
grant execute on function public.list_partner_companies(uuid, text, text) to authenticated;

-- Send a connection request from one company to a compatible company.
create or replace function public.send_connection_request(
  p_from_company_id uuid,
  p_to_company_id uuid,
  p_note text default ''
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_from_name text;
  v_owner uuid;
  v_compatible boolean;
begin
  if not public.is_member_of(p_from_company_id) and not public.is_admin() then
    raise exception 'Not a member of this company' using errcode = '42501';
  end if;
  if p_from_company_id = p_to_company_id then
    raise exception 'Cannot connect to your own company' using errcode = '22023';
  end if;

  -- Compatibility gate: some held role of target must be a partner of some viewer role.
  select exists (
    select 1
      from unnest(public.company_held_roles(p_from_company_id)) vr
      join unnest(public.company_held_roles(p_to_company_id)) tr
        on tr = any(public.role_works_with(vr))
  ) into v_compatible;
  if not v_compatible then
    raise exception 'These companies are not compatible partners' using errcode = '22023';
  end if;

  -- Reuse an existing row if any (either direction) so we never duplicate.
  select id into v_id from public.company_connections
   where (requester_company_id = p_from_company_id and target_company_id = p_to_company_id)
      or (requester_company_id = p_to_company_id and target_company_id = p_from_company_id)
   limit 1;

  if v_id is not null then
    update public.company_connections
       set status = 'Pending', note = coalesce(p_note, note), requested_by = auth.uid(),
           requester_company_id = p_from_company_id, target_company_id = p_to_company_id,
           responded_by = null, responded_at = null
     where id = v_id;
  else
    insert into public.company_connections (requester_company_id, target_company_id, note, requested_by)
    values (p_from_company_id, p_to_company_id, coalesce(p_note,''), auth.uid())
    returning id into v_id;
  end if;

  select name into v_from_name from public.companies where id = p_from_company_id;
  for v_owner in
    select user_id from public.company_users
     where company_id = p_to_company_id and company_role = 'Owner' and status = 'Active'
  loop
    perform public.queue_notification(v_owner, 'system',
      'New partner request 🤝',
      coalesce(v_from_name,'A company') || ' wants to connect with you.',
      'company_connections', v_id::text, jsonb_build_object('from', p_from_company_id));
  end loop;

  return v_id;
end;
$$;
grant execute on function public.send_connection_request(uuid, uuid, text) to authenticated;

-- Target company owner accepts / declines an incoming request.
create or replace function public.respond_connection_request(
  p_connection_id uuid,
  p_accept boolean
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_conn public.company_connections%rowtype;
  v_target_name text;
  v_owner uuid;
begin
  select * into v_conn from public.company_connections where id = p_connection_id;
  if v_conn.id is null then raise exception 'Connection not found' using errcode = '22023'; end if;
  if not public.is_member_of(v_conn.target_company_id) and not public.is_admin() then
    raise exception 'Only the requested company can respond' using errcode = '42501';
  end if;
  if v_conn.status <> 'Pending' then raise exception 'Already responded' using errcode = '22023'; end if;

  update public.company_connections
     set status = case when p_accept then 'Accepted' else 'Declined' end,
         responded_by = auth.uid(), responded_at = now()
   where id = p_connection_id;

  select name into v_target_name from public.companies where id = v_conn.target_company_id;
  for v_owner in
    select user_id from public.company_users
     where company_id = v_conn.requester_company_id and company_role = 'Owner' and status = 'Active'
  loop
    perform public.queue_notification(v_owner, 'system',
      case when p_accept then 'Partner request accepted ✅' else 'Partner request declined' end,
      coalesce(v_target_name,'The company') || (case when p_accept then ' accepted your connection.' else ' declined your connection.' end),
      'company_connections', p_connection_id::text, '{}'::jsonb);
  end loop;
end;
$$;
grant execute on function public.respond_connection_request(uuid, boolean) to authenticated;

-- My connections (accepted + pending, both directions) for a company.
create or replace function public.my_connections(p_company_id uuid)
returns table (
  connection_id uuid, other_company_id uuid, other_name text, other_type text,
  other_city text, status text, direction text, note text, created_at timestamptz
) language sql stable security definer set search_path = public as $$
  select conn.id,
         other.id,
         other.name,
         other.type::text,
         other.city,
         conn.status,
         case when conn.requester_company_id = p_company_id then 'outgoing' else 'incoming' end,
         conn.note,
         conn.created_at
    from public.company_connections conn
    join public.companies other
      on other.id = case when conn.requester_company_id = p_company_id
                         then conn.target_company_id else conn.requester_company_id end
   where (public.is_member_of(p_company_id) or public.is_admin())
     and (conn.requester_company_id = p_company_id or conn.target_company_id = p_company_id)
   order by conn.created_at desc;
$$;
grant execute on function public.my_connections(uuid) to authenticated;
