-- =========================================================================
-- 0167 — Global Freight world (International Shipping & Freight Exchange)
-- Idempotent & additive. Safe to run multiple times.
--
-- A standalone sixth world. A cargo owner (Importer/Exporter — or any existing
-- company) posts a SINGLE freight quote request through a step wizard: route,
-- mode (air/ocean/truck/FCL/LCL), weight/volume, cargo details, delivery
-- method, and documents. Every new request starts as 'PendingReview'; it is
-- visible to providers but flagged and not quotable until an admin approves it.
-- Once 'Open', freight providers (Freight Forwarders, Global Freight Forwarders,
-- Carriers/Shipping Lines) submit competing offers. When the customer wants
-- container pickup / drayage, trucking & drayage companies can submit a
-- SEPARATE ground-leg offer. The customer accepts the best offer and a shared
-- chat opens for coordination.
-- =========================================================================

-- ─── 1) Extend role + company-type enums ────────────────────────────────────
do $$ begin alter type user_role add value if not exists 'ImporterExporter';      exception when others then null; end $$;
do $$ begin alter type user_role add value if not exists 'GlobalFreightForwarder'; exception when others then null; end $$;
do $$ begin alter type user_role add value if not exists 'Carrier';               exception when others then null; end $$;

do $$ begin alter type company_type add value if not exists 'ImporterExporter';      exception when others then null; end $$;
do $$ begin alter type company_type add value if not exists 'GlobalFreightForwarder'; exception when others then null; end $$;
do $$ begin alter type company_type add value if not exists 'Carrier';               exception when others then null; end $$;

-- ─── 2) Refresh handle_new_user() with the three new role mappings ───────────
-- Based verbatim on 0156_guest_access.sql; only the company-type CASE and the
-- agent-vertical CASE gain the three new roles.
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
    when 'EquipmentRentalCompany' then 'EquipmentRentalCompany'::company_type
    when 'MobileRepairProvider' then 'MobileRepairProvider'::company_type
    when 'CargoInsurer' then 'CargoInsurer'::company_type
    when 'MarketplaceBuyer' then 'MarketplaceBuyer'::company_type
    when 'EmploymentAgency' then 'EmploymentAgency'::company_type
    when 'CustomsBroker' then 'CustomsBroker'::company_type
    when 'ImporterExporter' then 'ImporterExporter'::company_type
    when 'GlobalFreightForwarder' then 'GlobalFreightForwarder'::company_type
    when 'Carrier' then 'Carrier'::company_type
    else null
  end;

  if v_company_type is not null and coalesce(v_company_name, '') <> '' then
    insert into public.companies (name, type, city, status)
    values (v_company_name, v_company_type, v_company_city, 'PendingApproval')
    returning id into v_company_id;
  end if;

  -- Guest signup → auto-approved personal guest company.
  if v_role::text = 'Guest' then
    insert into public.companies (name, type, city, status, is_guest)
    values (
      coalesce(nullif(trim(coalesce(v_company_name, '')), ''), v_name || ' (Guest)'),
      'Customer'::company_type, v_company_city, 'Approved', true
    )
    returning id into v_company_id;
  end if;

  insert into public.profiles (id, email, name, role, company_id)
  values (new.id, new.email, v_name, v_role, v_company_id);

  if v_company_id is not null then
    insert into public.company_users (company_id, user_id, company_role, status)
    values (v_company_id, new.id, 'Owner', 'Active');
  end if;

  if v_role = 'SalesAgent' then
    perform public.ensure_sales_agent(new.id);
  end if;

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

  if v_role = 'Worker' then
    update public.agency_workers
       set worker_user_id = new.id, status = 'Active', updated_at = now()
     where worker_user_id is null
       and lower(email) = lower(new.email)
       and status = 'Invited';
  end if;

  if v_agent_code is not null and v_role <> 'SalesAgent' then
    v_vertical := case v_role
      when 'WarehouseProvider' then 'warehouse'
      when 'DrayageCompany' then 'drayage'
      when 'FreightForwarder' then 'freight_forwarder'
      when 'CustomsBroker' then 'freight_forwarder'
      when 'GlobalFreightForwarder' then 'freight_forwarder'
      when 'Carrier' then 'freight_forwarder'
      when 'ImporterExporter' then 'customer'
      when 'Employer' then 'employer'
      when 'EmploymentAgency' then 'employer'
      when 'TruckingCompany' then 'trucking'
      when 'Shipper' then 'shipper'
      when 'Customer' then 'customer'
      when 'ServiceProvider' then 'service'
      when 'Worker' then 'worker'
      when 'Driver' then 'driver'
      when 'EquipmentRentalCompany' then 'service'
      when 'MobileRepairProvider' then 'service'
      when 'CargoInsurer' then 'service'
      when 'MarketplaceBuyer' then 'customer'
      else 'customer'
    end;
    begin
      perform public.attribute_account_to_agent(v_agent_code, new.id, v_company_id, v_vertical, 'code');
    exception when others then
      raise warning 'handle_new_user: agent attribution failed for %: %', new.email, sqlerrm;
    end;
  end if;

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

-- ─── 3) Provider eligibility helpers ────────────────────────────────────────
-- Main freight quote providers: forwarders + global forwarders + carriers.
create or replace function public.freight_quote_provider_for(p_user_id uuid default null)
returns uuid
language sql stable security definer set search_path = public
as $$
  select cu.company_id
  from public.company_users cu
  join public.companies c on c.id = cu.company_id
  where cu.user_id = coalesce(p_user_id, auth.uid())
    and cu.status = 'Active'
    and c.type::text in ('FreightForwarder','GlobalFreightForwarder','Carrier')
  limit 1;
$$;
grant execute on function public.freight_quote_provider_for(uuid) to authenticated;

-- Ground-leg providers (container pickup / drayage): trucking + drayage companies.
create or replace function public.freight_ground_provider_for(p_user_id uuid default null)
returns uuid
language sql stable security definer set search_path = public
as $$
  select cu.company_id
  from public.company_users cu
  join public.companies c on c.id = cu.company_id
  where cu.user_id = coalesce(p_user_id, auth.uid())
    and cu.status = 'Active'
    and c.type::text in ('TruckingCompany','DrayageCompany')
  limit 1;
$$;
grant execute on function public.freight_ground_provider_for(uuid) to authenticated;

-- ─── 4) Core tables ─────────────────────────────────────────────────────────
create table if not exists public.freight_quotes (
  id uuid primary key default gen_random_uuid(),
  reference_code text not null unique default ('GF-' || upper(substr(md5(gen_random_uuid()::text), 1, 6))),
  customer_company_id uuid not null references public.companies(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  title text not null default '',
  -- Route
  origin_country text not null default '',
  origin_city text not null default '',
  origin_port text not null default '',
  dest_country text not null default '',
  dest_city text not null default '',
  dest_port text not null default '',
  -- Mode
  freight_mode text not null default 'ocean'
    check (freight_mode in ('air','ocean','truck','fcl','lcl')),
  -- Measurements
  weight numeric not null default 0,
  weight_unit text not null default 'kg' check (weight_unit in ('kg','lb')),
  volume numeric not null default 0,
  volume_unit text not null default 'cbm' check (volume_unit in ('cbm','cft')),
  length_val numeric not null default 0,
  width_val numeric not null default 0,
  height_val numeric not null default 0,
  dim_unit text not null default 'cm' check (dim_unit in ('cm','in')),
  pieces int not null default 1,
  -- Cargo details
  commodity text not null default '',
  declared_value numeric not null default 0,
  currency text not null default 'USD',
  hs_code text not null default '',
  notes text not null default '',
  ready_date date,
  -- Delivery method
  delivery_method text not null default 'port_delivery'
    check (delivery_method in ('door_pickup','port_delivery','booking_only')),
  pickup_address text not null default '',
  pickup_city text not null default '',
  needs_container_pickup boolean not null default false,
  -- Lifecycle
  status text not null default 'PendingReview'
    check (status in ('PendingReview','Open','Quoted','Accepted','Rejected','Cancelled')),
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  rejected_reason text not null default '',
  -- Award (main freight leg)
  awarded_offer_id uuid,
  awarded_company_id uuid references public.companies(id) on delete set null,
  awarded_amount numeric not null default 0,
  booked_at timestamptz,
  -- Award (ground leg)
  ground_awarded_offer_id uuid,
  ground_awarded_company_id uuid references public.companies(id) on delete set null,
  ground_awarded_amount numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_freight_quotes_customer on public.freight_quotes(customer_company_id);
create index if not exists idx_freight_quotes_status   on public.freight_quotes(status);
create index if not exists idx_freight_quotes_awarded  on public.freight_quotes(awarded_company_id);

create table if not exists public.freight_quote_offers (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.freight_quotes(id) on delete cascade,
  provider_company_id uuid not null references public.companies(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  offer_kind text not null default 'freight' check (offer_kind in ('freight','ground')),
  amount numeric not null default 0,
  currency text not null default 'USD',
  transit_days int not null default 0,
  valid_until date,
  note text not null default '',
  status text not null default 'Pending'
    check (status in ('Pending','Accepted','Rejected','Withdrawn')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (quote_id, provider_company_id, offer_kind)
);
create index if not exists idx_freight_offers_quote    on public.freight_quote_offers(quote_id);
create index if not exists idx_freight_offers_provider on public.freight_quote_offers(provider_company_id);

create table if not exists public.freight_quote_documents (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.freight_quotes(id) on delete cascade,
  uploaded_by uuid references public.profiles(id) on delete set null,
  file_path text not null,
  file_name text not null default '',
  doc_type text not null default 'other',
  created_at timestamptz not null default now()
);
create index if not exists idx_freight_docs_quote on public.freight_quote_documents(quote_id);

create table if not exists public.freight_quote_messages (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.freight_quotes(id) on delete cascade,
  sender_user_id uuid references public.profiles(id) on delete set null,
  sender_name text not null default '',
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_freight_msg_quote on public.freight_quote_messages(quote_id, created_at);

-- ─── 5) Party helper ────────────────────────────────────────────────────────
-- True when caller is the customer side, an awarded provider, or admin.
create or replace function public.is_freight_party(p_quote_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.freight_quotes q
    where q.id = p_quote_id
      and (
        public.is_member_of(q.customer_company_id)
        or (q.awarded_company_id is not null and public.is_member_of(q.awarded_company_id))
        or (q.ground_awarded_company_id is not null and public.is_member_of(q.ground_awarded_company_id))
        or public.is_admin()
      )
  );
$$;
grant execute on function public.is_freight_party(uuid) to authenticated;

-- ─── 6) RLS ─────────────────────────────────────────────────────────────────
alter table public.freight_quotes enable row level security;

drop policy if exists "freight_quotes_read" on public.freight_quotes;
create policy "freight_quotes_read" on public.freight_quotes for select using (
  public.is_member_of(customer_company_id)
  or (awarded_company_id is not null and public.is_member_of(awarded_company_id))
  or (ground_awarded_company_id is not null and public.is_member_of(ground_awarded_company_id))
  -- Providers see requests (flagged while PendingReview, quotable once Open).
  or (
    status in ('PendingReview','Open','Quoted','Accepted')
    and (public.freight_quote_provider_for() is not null or public.freight_ground_provider_for() is not null)
  )
  or exists (
    select 1 from public.freight_quote_offers o
    where o.quote_id = freight_quotes.id and public.is_member_of(o.provider_company_id)
  )
  or public.is_admin()
);

drop policy if exists "freight_quotes_insert" on public.freight_quotes;
create policy "freight_quotes_insert" on public.freight_quotes for insert with check (
  created_by = auth.uid() and public.is_member_of(customer_company_id)
);

drop policy if exists "freight_quotes_update" on public.freight_quotes;
create policy "freight_quotes_update" on public.freight_quotes for update
  using (public.is_freight_party(id))
  with check (public.is_freight_party(id));

alter table public.freight_quote_offers enable row level security;

drop policy if exists "freight_offers_read" on public.freight_quote_offers;
create policy "freight_offers_read" on public.freight_quote_offers for select using (
  public.is_member_of(provider_company_id)
  or exists (
    select 1 from public.freight_quotes q
    where q.id = freight_quote_offers.quote_id
      and (public.is_member_of(q.customer_company_id) or public.is_admin())
  )
);

drop policy if exists "freight_offers_write" on public.freight_quote_offers;
create policy "freight_offers_write" on public.freight_quote_offers for all
  using (public.is_member_of(provider_company_id) or public.is_admin())
  with check (public.is_member_of(provider_company_id) or public.is_admin());

alter table public.freight_quote_documents enable row level security;

drop policy if exists "freight_docs_read" on public.freight_quote_documents;
create policy "freight_docs_read" on public.freight_quote_documents for select using (
  public.is_freight_party(quote_id)
  or exists (
    select 1 from public.freight_quotes q
    where q.id = freight_quote_documents.quote_id
      and (public.freight_quote_provider_for() is not null or public.freight_ground_provider_for() is not null)
      and q.status in ('PendingReview','Open','Quoted','Accepted')
  )
);

drop policy if exists "freight_docs_insert" on public.freight_quote_documents;
create policy "freight_docs_insert" on public.freight_quote_documents for insert with check (
  uploaded_by = auth.uid()
  and exists (
    select 1 from public.freight_quotes q
    where q.id = freight_quote_documents.quote_id and public.is_member_of(q.customer_company_id)
  )
);

alter table public.freight_quote_messages enable row level security;

drop policy if exists "freight_msg_read" on public.freight_quote_messages;
create policy "freight_msg_read" on public.freight_quote_messages for select using (
  public.is_freight_party(quote_id)
);

-- ─── 7) Refresh PostgREST schema cache ──────────────────────────────────────
notify pgrst, 'reload schema';
