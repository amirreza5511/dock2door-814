-- ===========================================================================
-- 0150 — Workspace customizations + automatic watchdog
--
-- 1) Auto watchdog: `ai_maybe_run_watchdog(min_minutes)` runs the existing
--    ai_run_watchdog() at most once per throttle window per company, so the
--    scan happens automatically whenever anyone from the company uses the
--    app — not only when the Copilot screen is opened.
-- 2) Per-company workspace customizations: member companies file change
--    requests for their own pages (hide modules, custom order fields,
--    defaults, free-form asks). Platform admins approve/reject; approved
--    structured payloads are applied instantly to that company's workspace.
-- 3) drayage_orders.custom_fields — values captured by company-defined
--    custom fields on the container order form.
--
-- All changes are additive and safe for existing data.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1) AUTO WATCHDOG
-- ---------------------------------------------------------------------------
create table if not exists public.ai_watchdog_state (
  company_id uuid primary key references public.companies(id) on delete cascade,
  last_run_at timestamptz not null default now(),
  last_created int not null default 0
);

alter table public.ai_watchdog_state enable row level security;
drop policy if exists ai_watchdog_state_select on public.ai_watchdog_state;
create policy ai_watchdog_state_select on public.ai_watchdog_state
  for select using (public.is_member_of(company_id) or public.is_admin());

create or replace function public.ai_maybe_run_watchdog(p_min_minutes int default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_company uuid;
  v_last timestamptz;
  v_created int := 0;
begin
  select company_id into v_company from public.profiles where id = auth.uid();
  if v_company is null then
    return jsonb_build_object('ran', false, 'created', 0);
  end if;

  select last_run_at into v_last from public.ai_watchdog_state where company_id = v_company;
  if v_last is not null and v_last > now() - make_interval(mins => greatest(coalesce(p_min_minutes, 30), 5)) then
    return jsonb_build_object('ran', false, 'created', 0);
  end if;

  v_created := public.ai_run_watchdog();

  insert into public.ai_watchdog_state (company_id, last_run_at, last_created)
  values (v_company, now(), v_created)
  on conflict (company_id) do update
    set last_run_at = now(), last_created = excluded.last_created;

  return jsonb_build_object('ran', true, 'created', v_created);
end; $$;

grant execute on function public.ai_maybe_run_watchdog(int) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) WORKSPACE CUSTOMIZATIONS
-- ---------------------------------------------------------------------------
-- Active (approved) settings per company. Shape of `settings`:
--   { "hiddenModules": ["reports", ...],
--     "customFields": [{ "key","label","type","required" }, ...],
--     "defaults": { "invoiceDueDays": 21, ... },
--     "terminology": { "Chassis": "Trailer", ... } }
create table if not exists public.company_customizations (
  company_id uuid primary key references public.companies(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.company_customizations enable row level security;
drop policy if exists company_customizations_select on public.company_customizations;
create policy company_customizations_select on public.company_customizations
  for select using (public.is_member_of(company_id) or public.is_admin());

-- Change requests filed by companies, decided by platform admins.
create table if not exists public.company_customization_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  requested_by uuid references public.profiles(id) on delete set null,
  title text not null default '',
  details text not null default '',
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  admin_note text not null default '',
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists ccr_company_idx on public.company_customization_requests (company_id, created_at desc);
create index if not exists ccr_status_idx on public.company_customization_requests (status, created_at desc);

alter table public.company_customization_requests enable row level security;
drop policy if exists ccr_select on public.company_customization_requests;
create policy ccr_select on public.company_customization_requests
  for select using (public.is_member_of(company_id) or public.is_admin());

-- Active settings for the caller's company ('{}' when none).
create or replace function public.get_company_customizations()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_company uuid;
begin
  select company_id into v_company from public.profiles where id = auth.uid();
  if v_company is null then return '{}'::jsonb; end if;
  return coalesce((select settings from public.company_customizations where company_id = v_company), '{}'::jsonb);
end; $$;

grant execute on function public.get_company_customizations() to authenticated;

-- File a customization request for the caller's company.
create or replace function public.submit_customization_request(
  p_title text,
  p_details text default '',
  p_payload jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_company uuid;
  v_id uuid;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;
  select company_id into v_company from public.profiles where id = auth.uid();
  if v_company is null or not public.is_member_of(v_company) then
    raise exception 'you must belong to a company to request customizations';
  end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'a short title is required'; end if;

  insert into public.company_customization_requests (company_id, requested_by, title, details, payload)
  values (v_company, auth.uid(), left(trim(p_title), 200), left(coalesce(p_details, ''), 4000), coalesce(p_payload, '{}'::jsonb))
  returning id into v_id;

  perform public.write_audit('customization_requested', 'company_customization_requests', v_id::text, null,
    jsonb_build_object('company', v_company, 'title', left(trim(p_title), 200)), '');

  return v_id;
end; $$;

grant execute on function public.submit_customization_request(text, text, jsonb) to authenticated;

-- List requests: 'mine' = caller's company, 'all' = platform admins only.
create or replace function public.list_customization_requests(p_scope text default 'mine')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_company uuid;
  v_out jsonb;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;

  if lower(coalesce(p_scope, 'mine')) = 'all' then
    if not public.is_admin() then raise exception 'admins only'; end if;
    select coalesce(jsonb_agg(t.row_j order by t.pending_first asc, t.created_at desc), '[]'::jsonb) into v_out
    from (
      select jsonb_build_object(
        'id', r.id, 'companyId', r.company_id, 'companyName', coalesce(c.name, ''),
        'companyType', coalesce(c.type::text, ''),
        'requesterName', coalesce(p.name, ''),
        'title', r.title, 'details', r.details, 'payload', r.payload,
        'status', r.status, 'adminNote', r.admin_note,
        'createdAt', r.created_at, 'decidedAt', r.decided_at
      ) as row_j,
      case when r.status = 'pending' then 0 else 1 end as pending_first,
      r.created_at
      from public.company_customization_requests r
      left join public.companies c on c.id = r.company_id
      left join public.profiles p on p.id = r.requested_by
    ) t;
    return v_out;
  end if;

  select company_id into v_company from public.profiles where id = auth.uid();
  if v_company is null then return '[]'::jsonb; end if;

  select coalesce(jsonb_agg(t.row_j order by t.created_at desc), '[]'::jsonb) into v_out
  from (
    select jsonb_build_object(
      'id', r.id, 'companyId', r.company_id, 'companyName', '',
      'companyType', '',
      'requesterName', coalesce(p.name, ''),
      'title', r.title, 'details', r.details, 'payload', r.payload,
      'status', r.status, 'adminNote', r.admin_note,
      'createdAt', r.created_at, 'decidedAt', r.decided_at
    ) as row_j,
    r.created_at
    from public.company_customization_requests r
    left join public.profiles p on p.id = r.requested_by
    where r.company_id = v_company
  ) t;
  return v_out;
end; $$;

grant execute on function public.list_customization_requests(text) to authenticated;

-- Approve/reject a request. On approval the structured payload is applied to
-- the company's active settings:
--   hiddenModules / customFields  → replaced with the requested value
--   defaults / terminology        → shallow-merged
create or replace function public.decide_customization_request(
  p_request_id uuid,
  p_approve boolean,
  p_note text default ''
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_settings jsonb;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;

  select * into r from public.company_customization_requests where id = p_request_id for update;
  if r.id is null then raise exception 'request not found'; end if;
  if r.status <> 'pending' then raise exception 'this request was already decided'; end if;

  update public.company_customization_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      admin_note = left(coalesce(p_note, ''), 2000),
      decided_by = auth.uid(),
      decided_at = now()
  where id = p_request_id;

  if p_approve then
    select coalesce(settings, '{}'::jsonb) into v_settings
    from public.company_customizations where company_id = r.company_id;
    v_settings := coalesce(v_settings, '{}'::jsonb);

    if r.payload ? 'hiddenModules' then
      v_settings := jsonb_set(v_settings, '{hiddenModules}', coalesce(r.payload->'hiddenModules', '[]'::jsonb));
    end if;
    if r.payload ? 'customFields' then
      v_settings := jsonb_set(v_settings, '{customFields}', coalesce(r.payload->'customFields', '[]'::jsonb));
    end if;
    if r.payload ? 'defaults' then
      v_settings := jsonb_set(v_settings, '{defaults}',
        coalesce(v_settings->'defaults', '{}'::jsonb) || coalesce(r.payload->'defaults', '{}'::jsonb));
    end if;
    if r.payload ? 'terminology' then
      v_settings := jsonb_set(v_settings, '{terminology}',
        coalesce(v_settings->'terminology', '{}'::jsonb) || coalesce(r.payload->'terminology', '{}'::jsonb));
    end if;

    insert into public.company_customizations (company_id, settings, updated_at)
    values (r.company_id, v_settings, now())
    on conflict (company_id) do update
      set settings = excluded.settings, updated_at = now();
  end if;

  perform public.write_audit(
    'customization_' || case when p_approve then 'approved' else 'rejected' end,
    'company_customization_requests', p_request_id::text, null,
    jsonb_build_object('company', r.company_id, 'title', r.title), '');

  return jsonb_build_object('id', p_request_id, 'status', case when p_approve then 'approved' else 'rejected' end);
end; $$;

grant execute on function public.decide_customization_request(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) CUSTOM FIELD VALUES ON DRAYAGE ORDERS
-- ---------------------------------------------------------------------------
alter table public.drayage_orders
  add column if not exists custom_fields jsonb not null default '{}'::jsonb;

create or replace function public.set_order_custom_fields(p_order_id uuid, p_values jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_order record;
begin
  if not public.is_authenticated() then raise exception 'not authenticated'; end if;

  select id, customer_user_id, customer_company_id, drayage_company_id
  into v_order from public.drayage_orders where id = p_order_id;
  if v_order.id is null then raise exception 'order not found'; end if;

  if not (
    v_order.customer_user_id = auth.uid()
    or (v_order.customer_company_id is not null and public.is_member_of(v_order.customer_company_id))
    or (v_order.drayage_company_id is not null and public.is_member_of(v_order.drayage_company_id))
    or public.is_admin()
  ) then
    raise exception 'you are not allowed to edit this order';
  end if;

  update public.drayage_orders
  set custom_fields = coalesce(custom_fields, '{}'::jsonb) || coalesce(p_values, '{}'::jsonb)
  where id = p_order_id;

  return (select custom_fields from public.drayage_orders where id = p_order_id);
end; $$;

grant execute on function public.set_order_custom_fields(uuid, jsonb) to authenticated;
