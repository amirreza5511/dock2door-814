-- =========================================================================
-- 0113 — Sales Agent CRM + configurable commissions
-- Idempotent & self-healing. Safe to run multiple times.
--
-- Adds a full sales-agent layer on top of Dock2Door:
--   * SalesAgent role (no company; earns commissions from Dock2Door).
--   * commission_plans — named, fully-configurable plans (bounty / recurring %
--     / referral fee / tiered bonuses) stored as jsonb so admins can tune them
--     without a schema change. One plan is the default; agents can be assigned
--     any plan (per-agent override) or a named campaign plan.
--   * sales_agents — one row per agent, with a unique shareable agent code.
--   * agent_leads — the CRM pipeline (New→Contacted→Onboarding→Won/Lost).
--   * agent_attributions — links an onboarded account to the agent who brought
--     them (via agent code at signup, or manually by an admin).
--   * commission_entries — the money ledger (Pending→Approved→Paid / Rejected).
--
-- Attribution auto-creates a one-time bounty; hitting a tier threshold auto-
-- creates a bonus; a helper records recurring % when an attributed account
-- generates revenue.
-- =========================================================================

-- 1) Role -------------------------------------------------------------------
do $$ begin
  alter type user_role add value if not exists 'SalesAgent';
exception when others then null; end $$;

-- 2) commission_plans -------------------------------------------------------
create table if not exists public.commission_plans (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text not null default '',
  config      jsonb not null default '{}'::jsonb,
  is_default  boolean not null default false,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Only one default plan.
create unique index if not exists idx_commission_plans_one_default
  on public.commission_plans (is_default) where is_default;

-- Seed the default plan once, with sensible starter numbers (all editable).
insert into public.commission_plans (name, description, config, is_default, active)
select 'Default Plan',
       'Standard commission plan applied to every new agent.',
       jsonb_build_object(
         'bounty', jsonb_build_object(
           'warehouse', 150, 'drayage', 150, 'employer', 100, 'trucking', 200,
           'shipper', 50, 'customer', 50, 'service', 100, 'freight_forwarder', 150
         ),
         'recurring', jsonb_build_object(
           'warehouse', 2, 'drayage', 2, 'employer', 1.5, 'trucking', 3,
           'shipper', 1, 'customer', 1, 'service', 2, 'freight_forwarder', 2
         ),
         'referral', jsonb_build_object(
           'worker', 25, 'driver', 75, 'owner_operator', 100
         ),
         'tiers', jsonb_build_array(
           jsonb_build_object('threshold', 10, 'bonus', 500),
           jsonb_build_object('threshold', 25, 'bonus', 1500)
         )
       ),
       true, true
where not exists (select 1 from public.commission_plans where is_default);

-- 3) sales_agents -----------------------------------------------------------
create table if not exists public.sales_agents (
  id            uuid primary key references public.profiles(id) on delete cascade,
  agent_code    text not null,
  plan_id       uuid references public.commission_plans(id),
  status        text not null default 'Active',
  territory     text not null default '',
  phone         text not null default '',
  notes         text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists idx_sales_agents_code
  on public.sales_agents (agent_code);

-- 4) agent_leads ------------------------------------------------------------
create table if not exists public.agent_leads (
  id                uuid primary key default gen_random_uuid(),
  agent_id          uuid not null references public.sales_agents(id) on delete cascade,
  business_name     text not null default '',
  contact_name      text not null default '',
  contact_email     text not null default '',
  contact_phone     text not null default '',
  vertical          text not null default 'warehouse',
  status            text not null default 'New',
  notes             text not null default '',
  linked_user_id    uuid references public.profiles(id),
  linked_company_id uuid references public.companies(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_agent_leads_agent on public.agent_leads (agent_id);

-- 5) agent_attributions -----------------------------------------------------
create table if not exists public.agent_attributions (
  id                 uuid primary key default gen_random_uuid(),
  agent_id           uuid not null references public.sales_agents(id) on delete cascade,
  account_user_id    uuid references public.profiles(id),
  account_company_id uuid references public.companies(id),
  vertical           text not null default 'warehouse',
  source             text not null default 'code',
  created_at         timestamptz not null default now()
);

-- An account (company OR user) can only be attributed to one agent.
create unique index if not exists idx_attr_company
  on public.agent_attributions (account_company_id) where account_company_id is not null;
create unique index if not exists idx_attr_user
  on public.agent_attributions (account_user_id) where account_user_id is not null;
create index if not exists idx_attr_agent on public.agent_attributions (agent_id);

-- 6) commission_entries (ledger) --------------------------------------------
create table if not exists public.commission_entries (
  id           uuid primary key default gen_random_uuid(),
  agent_id     uuid not null references public.sales_agents(id) on delete cascade,
  kind         text not null default 'bounty',      -- bounty | recurring | referral | bonus
  vertical     text not null default '',
  amount       numeric(12,2) not null default 0,
  currency     text not null default 'cad',
  status       text not null default 'Pending',      -- Pending | Approved | Paid | Rejected
  source_type  text not null default 'manual',       -- attribution | booking | lead | tier | manual
  source_id    uuid,
  description  text not null default '',
  created_at   timestamptz not null default now(),
  approved_at  timestamptz,
  paid_at      timestamptz
);

create index if not exists idx_comm_entries_agent on public.commission_entries (agent_id);
create index if not exists idx_comm_entries_status on public.commission_entries (status);

-- 7) agent code generator ---------------------------------------------------
create or replace function public.gen_agent_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
  v_i int;
  v_exists boolean;
begin
  loop
    v_code := 'AG';
    for v_i in 1..5 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;
    select exists(select 1 from public.sales_agents where agent_code = v_code) into v_exists;
    exit when not v_exists;
  end loop;
  return v_code;
end;
$$;

-- 8) ensure a sales_agents row exists for a profile (self-heal + signup) -----
create or replace function public.ensure_sales_agent(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_default uuid;
begin
  select agent_code into v_code from public.sales_agents where id = p_user_id;
  if v_code is not null then
    return v_code;
  end if;
  select id into v_default from public.commission_plans where is_default limit 1;
  v_code := public.gen_agent_code();
  insert into public.sales_agents (id, agent_code, plan_id)
  values (p_user_id, v_code, v_default)
  on conflict (id) do nothing;
  return v_code;
end;
$$;

grant execute on function public.ensure_sales_agent(uuid) to authenticated;

-- 9) core attribution + auto-commission logic ------------------------------
-- Links an onboarded account to an agent (by agent code) and awards the
-- one-time bounty for that vertical plus any newly-reached tier bonus.
create or replace function public.attribute_account_to_agent(
  p_agent_code       text,
  p_account_user_id  uuid,
  p_account_company_id uuid,
  p_vertical         text,
  p_source           text default 'code'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agent_id uuid;
  v_config jsonb;
  v_bounty numeric;
  v_attr_id uuid;
  v_won_count int;
  v_tier jsonb;
  v_threshold int;
  v_tier_bonus numeric;
begin
  if p_agent_code is null or trim(p_agent_code) = '' then
    return null;
  end if;

  select sa.id, coalesce(cp.config, '{}'::jsonb)
    into v_agent_id, v_config
  from public.sales_agents sa
  left join public.commission_plans cp on cp.id = sa.plan_id
  where sa.agent_code = upper(trim(p_agent_code))
    and sa.status = 'Active'
  limit 1;

  if v_agent_id is null then
    return null; -- unknown/invalid code — silently ignore so signup still works
  end if;

  -- Don't attribute an agent to their own account, and don't double-attribute.
  if v_agent_id = p_account_user_id then
    return null;
  end if;
  if p_account_company_id is not null
     and exists (select 1 from public.agent_attributions where account_company_id = p_account_company_id) then
    return null;
  end if;
  if p_account_user_id is not null
     and exists (select 1 from public.agent_attributions where account_user_id = p_account_user_id) then
    return null;
  end if;

  insert into public.agent_attributions (agent_id, account_user_id, account_company_id, vertical, source)
  values (v_agent_id, p_account_user_id, p_account_company_id, coalesce(p_vertical, 'warehouse'), coalesce(p_source, 'code'))
  returning id into v_attr_id;

  -- One-time bounty (or referral fee for people-type verticals).
  if p_vertical in ('worker', 'driver', 'owner_operator') then
    v_bounty := coalesce((v_config->'referral'->>p_vertical)::numeric, 0);
    if v_bounty > 0 then
      insert into public.commission_entries (agent_id, kind, vertical, amount, status, source_type, source_id, description)
      values (v_agent_id, 'referral', p_vertical, v_bounty, 'Pending', 'attribution', v_attr_id,
              'Referral fee for onboarding a ' || p_vertical);
    end if;
  else
    v_bounty := coalesce((v_config->'bounty'->>p_vertical)::numeric, 0);
    if v_bounty > 0 then
      insert into public.commission_entries (agent_id, kind, vertical, amount, status, source_type, source_id, description)
      values (v_agent_id, 'bounty', p_vertical, v_bounty, 'Pending', 'attribution', v_attr_id,
              'Signing bounty for onboarding a ' || p_vertical);
    end if;
  end if;

  -- Tier bonus: award when the agent's total attributed accounts hits a threshold.
  select count(*) into v_won_count from public.agent_attributions where agent_id = v_agent_id;
  for v_tier in select * from jsonb_array_elements(coalesce(v_config->'tiers', '[]'::jsonb))
  loop
    v_threshold := coalesce((v_tier->>'threshold')::int, 0);
    v_tier_bonus := coalesce((v_tier->>'bonus')::numeric, 0);
    if v_threshold > 0 and v_tier_bonus > 0 and v_won_count = v_threshold then
      insert into public.commission_entries (agent_id, kind, vertical, amount, status, source_type, description)
      values (v_agent_id, 'bonus', '', v_tier_bonus, 'Pending', 'tier',
              'Milestone bonus for reaching ' || v_threshold || ' onboarded accounts');
    end if;
  end loop;

  return v_attr_id;
end;
$$;

grant execute on function public.attribute_account_to_agent(text, uuid, uuid, text, text) to authenticated;

-- 10) recurring commission recorder (call when an attributed account earns) --
create or replace function public.record_recurring_commission(
  p_account_company_id uuid,
  p_gross_amount       numeric,
  p_vertical           text,
  p_source_id          uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agent_id uuid;
  v_config jsonb;
  v_pct numeric;
  v_amount numeric;
  v_id uuid;
begin
  if p_account_company_id is null or coalesce(p_gross_amount, 0) <= 0 then
    return null;
  end if;

  select aa.agent_id, coalesce(cp.config, '{}'::jsonb)
    into v_agent_id, v_config
  from public.agent_attributions aa
  join public.sales_agents sa on sa.id = aa.agent_id and sa.status = 'Active'
  left join public.commission_plans cp on cp.id = sa.plan_id
  where aa.account_company_id = p_account_company_id
  limit 1;

  if v_agent_id is null then
    return null;
  end if;

  v_pct := coalesce((v_config->'recurring'->>p_vertical)::numeric, 0);
  if v_pct <= 0 then
    return null;
  end if;

  v_amount := round(p_gross_amount * v_pct / 100.0, 2);
  if v_amount <= 0 then
    return null;
  end if;

  insert into public.commission_entries (agent_id, kind, vertical, amount, status, source_type, source_id, description)
  values (v_agent_id, 'recurring', p_vertical, v_amount, 'Pending', 'booking', p_source_id,
          v_pct || '% recurring commission on ' || p_vertical || ' revenue')
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.record_recurring_commission(uuid, numeric, text, uuid) to authenticated;

-- 11) handle_new_user: create agent row + apply agent-code attribution -------
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

  -- Agent-code attribution: if this new account entered a sales agent's code,
  -- link it to that agent and award the bounty/referral. Never block signup.
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

  return new;
end;
$$;

-- 12) agent lead upsert ------------------------------------------------------
create or replace function public.agent_upsert_lead(
  p_id uuid,
  p_business_name text,
  p_contact_name text,
  p_contact_email text,
  p_contact_phone text,
  p_vertical text,
  p_status text,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_id uuid;
begin
  if v_me is null then raise exception 'Not authenticated'; end if;
  perform public.ensure_sales_agent(v_me);

  if p_id is not null then
    update public.agent_leads set
      business_name = coalesce(p_business_name, business_name),
      contact_name  = coalesce(p_contact_name, contact_name),
      contact_email = coalesce(p_contact_email, contact_email),
      contact_phone = coalesce(p_contact_phone, contact_phone),
      vertical      = coalesce(p_vertical, vertical),
      status        = coalesce(p_status, status),
      notes         = coalesce(p_notes, notes),
      updated_at    = now()
    where id = p_id and agent_id = v_me
    returning id into v_id;
    if v_id is null then raise exception 'Lead not found'; end if;
    return v_id;
  end if;

  insert into public.agent_leads (agent_id, business_name, contact_name, contact_email, contact_phone, vertical, status, notes)
  values (v_me, coalesce(p_business_name, ''), coalesce(p_contact_name, ''), coalesce(p_contact_email, ''),
          coalesce(p_contact_phone, ''), coalesce(p_vertical, 'warehouse'), coalesce(p_status, 'New'), coalesce(p_notes, ''))
  returning id into v_id;
  return v_id;
end;
$$;

grant execute on function public.agent_upsert_lead(uuid, text, text, text, text, text, text, text) to authenticated;

-- 13) admin: upsert commission plan -----------------------------------------
create or replace function public.admin_upsert_commission_plan(
  p_id uuid,
  p_name text,
  p_description text,
  p_config jsonb,
  p_is_default boolean,
  p_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;

  if coalesce(p_is_default, false) then
    update public.commission_plans set is_default = false where is_default;
  end if;

  if p_id is not null then
    update public.commission_plans set
      name = coalesce(p_name, name),
      description = coalesce(p_description, description),
      config = coalesce(p_config, config),
      is_default = coalesce(p_is_default, is_default),
      active = coalesce(p_active, active),
      updated_at = now()
    where id = p_id
    returning id into v_id;
    return v_id;
  end if;

  insert into public.commission_plans (name, description, config, is_default, active)
  values (coalesce(p_name, 'Plan'), coalesce(p_description, ''), coalesce(p_config, '{}'::jsonb),
          coalesce(p_is_default, false), coalesce(p_active, true))
  returning id into v_id;
  return v_id;
end;
$$;

grant execute on function public.admin_upsert_commission_plan(uuid, text, text, jsonb, boolean, boolean) to authenticated;

-- 14) admin: assign a plan / status to an agent -----------------------------
create or replace function public.admin_update_agent(
  p_agent_id uuid,
  p_plan_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  update public.sales_agents set
    plan_id = coalesce(p_plan_id, plan_id),
    status = coalesce(p_status, status),
    updated_at = now()
  where id = p_agent_id;
end;
$$;

grant execute on function public.admin_update_agent(uuid, uuid, text) to authenticated;

-- 15) admin: manual attribution (link an existing account to an agent) -------
create or replace function public.admin_attribute_account(
  p_agent_code text,
  p_account_company_id uuid,
  p_account_user_id uuid,
  p_vertical text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  return public.attribute_account_to_agent(p_agent_code, p_account_user_id, p_account_company_id, p_vertical, 'manual');
end;
$$;

grant execute on function public.admin_attribute_account(text, uuid, uuid, text) to authenticated;

-- 16) admin: award a manual commission --------------------------------------
create or replace function public.admin_award_commission(
  p_agent_id uuid,
  p_kind text,
  p_vertical text,
  p_amount numeric,
  p_description text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  insert into public.commission_entries (agent_id, kind, vertical, amount, status, source_type, description)
  values (p_agent_id, coalesce(p_kind, 'manual'), coalesce(p_vertical, ''), coalesce(p_amount, 0), 'Pending', 'manual', coalesce(p_description, ''))
  returning id into v_id;
  return v_id;
end;
$$;

grant execute on function public.admin_award_commission(uuid, text, text, numeric, text) to authenticated;

-- 17) admin: change a commission entry status (approve / pay / reject) -------
create or replace function public.admin_set_commission_status(
  p_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_agent uuid;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  update public.commission_entries set
    status = p_status,
    approved_at = case when p_status in ('Approved','Paid') and approved_at is null then now() else approved_at end,
    paid_at = case when p_status = 'Paid' then now() when p_status <> 'Paid' then null else paid_at end
  where id = p_id
  returning agent_id into v_agent;

  if v_agent is not null and p_status = 'Paid' then
    insert into public.notifications (user_id, kind, title, body, entity_type, entity_id)
    values (v_agent, 'payment', 'Commission paid', 'A commission payout has been marked as paid.', 'commission_entries', p_id);
  elsif v_agent is not null and p_status = 'Approved' then
    insert into public.notifications (user_id, kind, title, body, entity_type, entity_id)
    values (v_agent, 'system', 'Commission approved', 'A commission was approved and is awaiting payout.', 'commission_entries', p_id);
  end if;
end;
$$;

grant execute on function public.admin_set_commission_status(uuid, text) to authenticated;

-- 18) RLS -------------------------------------------------------------------
alter table public.commission_plans   enable row level security;
alter table public.sales_agents        enable row level security;
alter table public.agent_leads         enable row level security;
alter table public.agent_attributions  enable row level security;
alter table public.commission_entries  enable row level security;

do $$ begin
  -- commission_plans: everyone signed-in can read; only admins write (via RPC).
  create policy comm_plans_read on public.commission_plans for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy comm_plans_admin on public.commission_plans for all to authenticated
    using (public.is_admin()) with check (public.is_admin());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy sales_agents_self on public.sales_agents for select to authenticated
    using (id = auth.uid() or public.is_admin());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy sales_agents_self_update on public.sales_agents for update to authenticated
    using (id = auth.uid()) with check (id = auth.uid());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy sales_agents_admin on public.sales_agents for all to authenticated
    using (public.is_admin()) with check (public.is_admin());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy agent_leads_own on public.agent_leads for all to authenticated
    using (agent_id = auth.uid() or public.is_admin())
    with check (agent_id = auth.uid() or public.is_admin());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy agent_attr_own on public.agent_attributions for select to authenticated
    using (agent_id = auth.uid() or public.is_admin());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy agent_attr_admin on public.agent_attributions for all to authenticated
    using (public.is_admin()) with check (public.is_admin());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy comm_entries_own on public.commission_entries for select to authenticated
    using (agent_id = auth.uid() or public.is_admin());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy comm_entries_admin on public.commission_entries for all to authenticated
    using (public.is_admin()) with check (public.is_admin());
exception when duplicate_object then null; end $$;

-- 19) backfill: give any existing SalesAgent profiles an agent record --------
do $$
declare r record;
begin
  for r in select id from public.profiles where role = 'SalesAgent'
  loop
    perform public.ensure_sales_agent(r.id);
  end loop;
exception when others then null;
end $$;

-- 20) Refresh PostgREST schema cache.
notify pgrst, 'reload schema';
