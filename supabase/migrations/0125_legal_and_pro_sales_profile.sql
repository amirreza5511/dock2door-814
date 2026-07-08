-- =========================================================================
-- 0125 — Legal acceptances (Terms + NDA for every role) & professional
--         sales-agent profile + CRM upgrade.
-- Idempotent & self-healing. Safe to run multiple times.
--
-- Adds:
--   * legal_acceptances — one row per (user, document) recording that a person
--     accepted the Terms & Conditions (all roles) or signed the NDA
--     (sales agents). Captures the version, typed signature and platform.
--   * record_legal_acceptance() — self-service RPC an authenticated user calls
--     to log an acceptance/signature.
--   * handle_new_user() extended to record acceptances straight from signup
--     metadata (works even before email confirmation, when there is no session).
--   * A full set of professional profile columns on sales_agents + a single
--     agent_save_profile() RPC.
--   * CRM upgrade columns on agent_leads + agent_save_lead() RPC (estimated
--     value, priority, source, next follow-up, last contact).
-- =========================================================================

-- 1) legal_acceptances ------------------------------------------------------
create table if not exists public.legal_acceptances (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  doc_type     text not null,                 -- 'terms' | 'nda' | 'privacy'
  doc_version  text not null default '1.0',
  signed_name  text not null default '',
  role         text not null default '',
  platform     text not null default '',
  accepted_at  timestamptz not null default now()
);

create unique index if not exists idx_legal_acceptance_unique
  on public.legal_acceptances (user_id, doc_type);
create index if not exists idx_legal_acceptance_user
  on public.legal_acceptances (user_id);

alter table public.legal_acceptances enable row level security;

do $$ begin
  create policy legal_acceptances_own on public.legal_acceptances for select to authenticated
    using (user_id = auth.uid() or public.is_admin());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy legal_acceptances_insert on public.legal_acceptances for insert to authenticated
    with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy legal_acceptances_admin on public.legal_acceptances for all to authenticated
    using (public.is_admin()) with check (public.is_admin());
exception when duplicate_object then null; end $$;

-- 2) record_legal_acceptance ------------------------------------------------
create or replace function public.record_legal_acceptance(
  p_doc_type    text,
  p_doc_version text,
  p_signed_name text,
  p_platform    text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_role text;
begin
  if v_me is null then raise exception 'Not authenticated'; end if;
  if coalesce(p_doc_type, '') = '' then raise exception 'doc_type is required'; end if;

  select role::text into v_role from public.profiles where id = v_me;

  insert into public.legal_acceptances (user_id, doc_type, doc_version, signed_name, role, platform)
  values (v_me, p_doc_type, coalesce(nullif(p_doc_version, ''), '1.0'),
          coalesce(p_signed_name, ''), coalesce(v_role, ''), coalesce(p_platform, ''))
  on conflict (user_id, doc_type) do update set
    doc_version = excluded.doc_version,
    signed_name = excluded.signed_name,
    platform    = excluded.platform,
    accepted_at = now();
end;
$$;

grant execute on function public.record_legal_acceptance(text, text, text, text) to authenticated;

-- 3) professional sales-agent profile columns ------------------------------
alter table public.sales_agents add column if not exists legal_name       text not null default '';
alter table public.sales_agents add column if not exists business_name    text not null default '';
alter table public.sales_agents add column if not exists address_line1    text not null default '';
alter table public.sales_agents add column if not exists address_line2    text not null default '';
alter table public.sales_agents add column if not exists city             text not null default '';
alter table public.sales_agents add column if not exists region           text not null default '';
alter table public.sales_agents add column if not exists postal_code      text not null default '';
alter table public.sales_agents add column if not exists country          text not null default '';
alter table public.sales_agents add column if not exists tax_id           text not null default '';
alter table public.sales_agents add column if not exists website          text not null default '';
alter table public.sales_agents add column if not exists linkedin         text not null default '';
alter table public.sales_agents add column if not exists bio              text not null default '';
alter table public.sales_agents add column if not exists id_type          text not null default '';
alter table public.sales_agents add column if not exists id_number        text not null default '';
alter table public.sales_agents add column if not exists date_of_birth    text not null default '';
alter table public.sales_agents add column if not exists emergency_name   text not null default '';
alter table public.sales_agents add column if not exists emergency_phone  text not null default '';
alter table public.sales_agents add column if not exists avatar_url       text not null default '';
alter table public.sales_agents add column if not exists profile_completed_at timestamptz;

-- 4) agent_save_profile (full professional profile) ------------------------
create or replace function public.agent_save_profile(p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_complete boolean;
begin
  if v_me is null then raise exception 'Not authenticated'; end if;
  perform public.ensure_sales_agent(v_me);

  v_complete := coalesce(p->>'legal_name', '') <> ''
            and coalesce(p->>'phone', '') <> ''
            and coalesce(p->>'territory', '') <> ''
            and coalesce(p->>'payout_method', '') <> '';

  update public.sales_agents set
    legal_name      = coalesce(p->>'legal_name', legal_name),
    business_name   = coalesce(p->>'business_name', business_name),
    phone           = coalesce(p->>'phone', phone),
    territory       = coalesce(p->>'territory', territory),
    address_line1   = coalesce(p->>'address_line1', address_line1),
    address_line2   = coalesce(p->>'address_line2', address_line2),
    city            = coalesce(p->>'city', city),
    region          = coalesce(p->>'region', region),
    postal_code     = coalesce(p->>'postal_code', postal_code),
    country         = coalesce(p->>'country', country),
    tax_id          = coalesce(p->>'tax_id', tax_id),
    website         = coalesce(p->>'website', website),
    linkedin        = coalesce(p->>'linkedin', linkedin),
    bio             = coalesce(p->>'bio', bio),
    id_type         = coalesce(p->>'id_type', id_type),
    id_number       = coalesce(p->>'id_number', id_number),
    date_of_birth   = coalesce(p->>'date_of_birth', date_of_birth),
    emergency_name  = coalesce(p->>'emergency_name', emergency_name),
    emergency_phone = coalesce(p->>'emergency_phone', emergency_phone),
    avatar_url      = coalesce(p->>'avatar_url', avatar_url),
    payout_method   = coalesce(p->>'payout_method', payout_method),
    payout_details  = coalesce(p->>'payout_details', payout_details),
    profile_completed_at = case when v_complete and profile_completed_at is null then now() else profile_completed_at end,
    updated_at      = now()
  where id = v_me;
end;
$$;

grant execute on function public.agent_save_profile(jsonb) to authenticated;

-- 5) CRM upgrade columns on agent_leads ------------------------------------
alter table public.agent_leads add column if not exists contact_title    text not null default '';
alter table public.agent_leads add column if not exists company_website  text not null default '';
alter table public.agent_leads add column if not exists city             text not null default '';
alter table public.agent_leads add column if not exists estimated_value  numeric(12,2) not null default 0;
alter table public.agent_leads add column if not exists priority         text not null default 'Medium';  -- Low | Medium | High
alter table public.agent_leads add column if not exists source           text not null default '';
alter table public.agent_leads add column if not exists next_action      text not null default '';
alter table public.agent_leads add column if not exists next_action_at   timestamptz;
alter table public.agent_leads add column if not exists last_contact_at  timestamptz;

-- 6) agent_save_lead (extended upsert) -------------------------------------
create or replace function public.agent_save_lead(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_id uuid;
  v_pid uuid := nullif(p->>'id', '')::uuid;
begin
  if v_me is null then raise exception 'Not authenticated'; end if;
  perform public.ensure_sales_agent(v_me);

  if v_pid is not null then
    update public.agent_leads set
      business_name   = coalesce(p->>'business_name', business_name),
      contact_name    = coalesce(p->>'contact_name', contact_name),
      contact_title   = coalesce(p->>'contact_title', contact_title),
      contact_email   = coalesce(p->>'contact_email', contact_email),
      contact_phone   = coalesce(p->>'contact_phone', contact_phone),
      company_website = coalesce(p->>'company_website', company_website),
      city            = coalesce(p->>'city', city),
      vertical        = coalesce(p->>'vertical', vertical),
      status          = coalesce(p->>'status', status),
      priority        = coalesce(p->>'priority', priority),
      source          = coalesce(p->>'source', source),
      estimated_value = coalesce((p->>'estimated_value')::numeric, estimated_value),
      next_action     = coalesce(p->>'next_action', next_action),
      next_action_at  = coalesce(nullif(p->>'next_action_at', '')::timestamptz, next_action_at),
      last_contact_at = coalesce(nullif(p->>'last_contact_at', '')::timestamptz, last_contact_at),
      notes           = coalesce(p->>'notes', notes),
      updated_at      = now()
    where id = v_pid and agent_id = v_me
    returning id into v_id;
    if v_id is null then raise exception 'Lead not found'; end if;
    return v_id;
  end if;

  insert into public.agent_leads (
    agent_id, business_name, contact_name, contact_title, contact_email, contact_phone,
    company_website, city, vertical, status, priority, source, estimated_value,
    next_action, next_action_at, last_contact_at, notes
  )
  values (
    v_me,
    coalesce(p->>'business_name', ''), coalesce(p->>'contact_name', ''), coalesce(p->>'contact_title', ''),
    coalesce(p->>'contact_email', ''), coalesce(p->>'contact_phone', ''),
    coalesce(p->>'company_website', ''), coalesce(p->>'city', ''),
    coalesce(p->>'vertical', 'warehouse'), coalesce(p->>'status', 'New'),
    coalesce(p->>'priority', 'Medium'), coalesce(p->>'source', ''),
    coalesce((p->>'estimated_value')::numeric, 0),
    coalesce(p->>'next_action', ''),
    nullif(p->>'next_action_at', '')::timestamptz,
    nullif(p->>'last_contact_at', '')::timestamptz,
    coalesce(p->>'notes', '')
  )
  returning id into v_id;
  return v_id;
end;
$$;

grant execute on function public.agent_save_lead(jsonb) to authenticated;

-- 7) handle_new_user: record Terms/NDA acceptance from signup metadata ------
-- Rebuilt from 0113 with the legal-acceptance recording appended. Everything
-- else is unchanged.
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
  v_fleet_code text;
  v_fleet_company_id uuid;
  v_agent_code text;
  v_vertical text;
begin
  v_requested_role := new.raw_user_meta_data->>'role';

  if v_requested_role in ('Admin', 'SuperAdmin') then
    v_role := 'Customer'::user_role;
    raise warning 'handle_new_user: blocked self-assignment of privileged role % for %', v_requested_role, new.email;
  else
    v_role := coalesce(v_requested_role::user_role, 'Customer'::user_role);
  end if;

  v_name := coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1));
  v_company_name := new.raw_user_meta_data->>'company_name';
  v_company_city := coalesce(new.raw_user_meta_data->>'city', 'Vancouver');
  v_fleet_code := nullif(trim(new.raw_user_meta_data->>'fleet_code'), '');
  v_agent_code := nullif(trim(new.raw_user_meta_data->>'agent_code'), '');

  v_company_type := case v_role
    when 'Customer' then 'Customer'::company_type
    when 'WarehouseProvider' then 'WarehouseProvider'::company_type
    when 'ServiceProvider' then 'ServiceProvider'::company_type
    when 'Employer' then 'Employer'::company_type
    when 'TruckingCompany' then 'TruckingCompany'::company_type
    when 'GateStaff' then 'WarehouseProvider'::company_type
    when 'Shipper' then 'Shipper'::company_type
    when 'DrayageCompany' then 'DrayageCompany'::company_type
    when 'FreightForwarder' then 'FreightForwarder'::company_type
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

  -- Sales agent self-registration → provision an agent record + code.
  if v_role = 'SalesAgent' then
    perform public.ensure_sales_agent(new.id);
  end if;

  -- Driver self-registration → link into the fleet as a PENDING request.
  if v_role = 'Driver' and v_fleet_code is not null then
    select id into v_fleet_company_id
    from public.companies where fleet_code = upper(v_fleet_code) limit 1;

    if v_fleet_company_id is not null then
      insert into public.drivers (company_id, profile_id, name, phone, status, data)
      values (
        v_fleet_company_id, new.id, v_name, '',
        'PendingApproval',
        jsonb_build_object('userId', new.id::text, 'email', new.email, 'name', v_name, 'selfRegistered', true)
      );

      insert into public.notifications (user_id, kind, title, body, entity_type, entity_id)
      select cu.user_id, 'system', 'Driver wants to join your fleet',
        v_name || ' requested to join. Approve them in Dispatch.',
        'drivers', v_fleet_company_id
      from public.company_users cu
      where cu.company_id = v_fleet_company_id and cu.status = 'Active';
    end if;
  end if;

  -- Agent-code attribution.
  if v_agent_code is not null and v_role <> 'SalesAgent' then
    v_vertical := case v_role
      when 'WarehouseProvider' then 'warehouse'
      when 'DrayageCompany' then 'drayage'
      when 'FreightForwarder' then 'freight_forwarder'
      when 'Employer' then 'employer'
      when 'TruckingCompany' then 'trucking'
      when 'Shipper' then 'shipper'
      when 'Customer' then 'customer'
      when 'ServiceProvider' then 'service'
      when 'Worker' then 'worker'
      when 'Driver' then 'driver'
      else 'customer'
    end;
    begin
      perform public.attribute_account_to_agent(v_agent_code, new.id, v_company_id, v_vertical, 'code');
    exception when others then
      raise warning 'handle_new_user: agent attribution failed for %: %', new.email, sqlerrm;
    end;
  end if;

  -- Legal acceptances captured at signup (Terms for everyone, NDA for agents).
  begin
    if coalesce(new.raw_user_meta_data->>'accepted_terms', '') = 'true' then
      insert into public.legal_acceptances (user_id, doc_type, doc_version, signed_name, role, platform)
      values (new.id, 'terms',
              coalesce(nullif(new.raw_user_meta_data->>'terms_version', ''), '1.0'),
              v_name, v_role::text, coalesce(new.raw_user_meta_data->>'signup_platform', ''))
      on conflict (user_id, doc_type) do nothing;
    end if;
    if coalesce(new.raw_user_meta_data->>'accepted_nda', '') = 'true' then
      insert into public.legal_acceptances (user_id, doc_type, doc_version, signed_name, role, platform)
      values (new.id, 'nda',
              coalesce(nullif(new.raw_user_meta_data->>'nda_version', ''), '1.0'),
              coalesce(nullif(new.raw_user_meta_data->>'nda_signed_name', ''), v_name),
              v_role::text, coalesce(new.raw_user_meta_data->>'signup_platform', ''))
      on conflict (user_id, doc_type) do nothing;
    end if;
  exception when others then
    raise warning 'handle_new_user: legal acceptance recording failed for %: %', new.email, sqlerrm;
  end;

  return new;
end;
$$;

-- 8) admin: read a user's legal acceptances (for the console) --------------
create or replace function public.admin_agent_detail(p_agent_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agent jsonb;
  v_legal jsonb;
  v_profile jsonb;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;

  select to_jsonb(sa.*) into v_agent from public.sales_agents sa where sa.id = p_agent_id;
  select to_jsonb(p.*) into v_profile from public.profiles p where p.id = p_agent_id;
  select coalesce(jsonb_agg(to_jsonb(la.*)), '[]'::jsonb) into v_legal
    from public.legal_acceptances la where la.user_id = p_agent_id;

  return jsonb_build_object('agent', v_agent, 'profile', v_profile, 'legal', v_legal);
end;
$$;

grant execute on function public.admin_agent_detail(uuid) to authenticated;

-- 9) Refresh PostgREST schema cache.
notify pgrst, 'reload schema';
