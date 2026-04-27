-- Dock2Door — Multi-carrier shipping abstraction layer
-- Adds: manifests, rate quotes, void status, platform-level carrier accounts.
-- Idempotent.

-- =========================================================================
-- ENUMS
-- =========================================================================
do $$ begin
  alter type shipment_status add value if not exists 'Voided';
exception when others then null; end $$;

do $$ begin
  create type carrier_account_scope as enum ('platform','company');
exception when duplicate_object then null; end $$;

do $$ begin
  create type manifest_status as enum ('Open','Closed','Submitted','Failed');
exception when duplicate_object then null; end $$;

-- =========================================================================
-- carrier_accounts hardening (multi-carrier scope)
-- =========================================================================
alter table public.carrier_accounts
  add column if not exists scope carrier_account_scope not null default 'company';
alter table public.carrier_accounts
  add column if not exists mode text not null default 'test';
alter table public.carrier_accounts
  add column if not exists credentials_secret_ref text default '';
alter table public.carrier_accounts
  add column if not exists last_verified_at timestamptz;
alter table public.carrier_accounts
  add column if not exists last_error text default '';

-- platform-scope rows do not need a real company; allow null and constrain
alter table public.carrier_accounts
  alter column company_id drop not null;
do $$ begin
  alter table public.carrier_accounts
    add constraint carrier_accounts_scope_chk
    check ((scope = 'platform' and company_id is null) or (scope = 'company' and company_id is not null));
exception when duplicate_object then null; end $$;

create index if not exists idx_carrier_accounts_carrier on public.carrier_accounts(carrier_code, scope, is_active);

-- platform accounts are admin-managed only, company accounts remain company-scoped
drop policy if exists "carrier_accounts_read" on public.carrier_accounts;
create policy "carrier_accounts_read" on public.carrier_accounts for select using (
  (scope = 'platform') or public.is_member_of(company_id) or public.is_admin()
);

drop policy if exists "carrier_accounts_write" on public.carrier_accounts;
create policy "carrier_accounts_write_company" on public.carrier_accounts for all
  using (scope = 'company' and (public.is_member_of(company_id) or public.is_admin()))
  with check (scope = 'company' and (public.is_member_of(company_id) or public.is_admin()));

drop policy if exists "carrier_accounts_write_platform" on public.carrier_accounts;
create policy "carrier_accounts_write_platform" on public.carrier_accounts for all
  using (scope = 'platform' and public.is_admin())
  with check (scope = 'platform' and public.is_admin());

-- =========================================================================
-- shipping_rate_quotes — cache rate-shop results so purchase can re-use rate id
-- =========================================================================
create table if not exists public.shipping_rate_quotes (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid references public.shipments(id) on delete cascade,
  requested_by uuid references auth.users(id) on delete set null,
  carrier_code text not null,
  carrier_account_id uuid references public.carrier_accounts(id) on delete set null,
  service_level text not null,
  service_name text default '',
  rate_amount numeric not null default 0,
  currency text not null default 'CAD',
  est_delivery_days int,
  est_delivery_date date,
  carrier_rate_id text default '',
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_rate_quotes_shipment on public.shipping_rate_quotes(shipment_id, rate_amount);
alter table public.shipping_rate_quotes enable row level security;

drop policy if exists "rate_quotes_read" on public.shipping_rate_quotes;
create policy "rate_quotes_read" on public.shipping_rate_quotes for select using (
  exists (select 1 from public.shipments s where s.id = shipping_rate_quotes.shipment_id
          and (public.is_member_of(s.customer_company_id) or public.is_member_of(s.provider_company_id) or public.is_admin()))
);

-- =========================================================================
-- shipping_manifests — carrier end-of-day closeout
-- =========================================================================
create table if not exists public.shipping_manifests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  carrier_code text not null,
  carrier_account_id uuid references public.carrier_accounts(id) on delete set null,
  status manifest_status not null default 'Open',
  manifest_number text default '',
  manifest_url text default '',
  shipment_count int not null default 0,
  submitted_at timestamptz,
  failed_reason text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_manifests_company on public.shipping_manifests(company_id, created_at desc);
alter table public.shipping_manifests enable row level security;

drop policy if exists "manifests_read" on public.shipping_manifests;
create policy "manifests_read" on public.shipping_manifests for select using (
  public.is_member_of(company_id) or public.is_admin()
);
drop policy if exists "manifests_write" on public.shipping_manifests;
create policy "manifests_write" on public.shipping_manifests for all
  using (public.is_member_of(company_id) or public.is_admin())
  with check (public.is_member_of(company_id) or public.is_admin());

-- link shipments to manifest (closeout)
alter table public.shipments
  add column if not exists manifest_id uuid references public.shipping_manifests(id) on delete set null;
alter table public.shipments
  add column if not exists void_requested_at timestamptz;
alter table public.shipments
  add column if not exists voided_at timestamptz;

-- =========================================================================
-- RPCs
-- =========================================================================

-- Mark shipment voided (called by edge function after carrier confirms)
create or replace function public.mark_shipment_voided(p_shipment_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_ship public.shipments;
begin
  select * into v_ship from public.shipments where id = p_shipment_id;
  if v_ship is null then raise exception 'shipment not found'; end if;
  if not (public.is_member_of(v_ship.provider_company_id) or public.is_admin()) then
    raise exception 'not authorized';
  end if;

  update public.shipments
    set status = 'Voided'::shipment_status,
        voided_at = now(),
        updated_at = now()
  where id = p_shipment_id;

  perform public.write_audit('shipment_voided', 'shipments', p_shipment_id::text, null,
    jsonb_build_object('reason', coalesce(p_reason,'')), coalesce(p_reason,''));
end; $$;
grant execute on function public.mark_shipment_voided(uuid, text) to authenticated;

-- Upsert carrier account (company-scope by company members; platform-scope by admin)
create or replace function public.upsert_carrier_account(
  p_id uuid,
  p_company_id uuid,
  p_scope carrier_account_scope,
  p_carrier_code text,
  p_display_name text,
  p_account_number text,
  p_mode text,
  p_credentials_secret_ref text,
  p_data jsonb,
  p_is_active boolean
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if p_scope = 'platform' then
    if not public.is_admin() then raise exception 'admin only'; end if;
    if p_company_id is not null then raise exception 'platform scope must have null company'; end if;
  else
    if p_company_id is null then raise exception 'company_id required for company scope'; end if;
    if not (public.is_member_of(p_company_id) or public.is_admin()) then raise exception 'not authorized'; end if;
  end if;

  if p_id is not null then
    update public.carrier_accounts
      set carrier_code = p_carrier_code,
          display_name = coalesce(p_display_name, ''),
          account_number = coalesce(p_account_number, ''),
          mode = coalesce(p_mode, 'test'),
          credentials_secret_ref = coalesce(p_credentials_secret_ref, ''),
          data = coalesce(p_data, '{}'::jsonb),
          is_active = coalesce(p_is_active, true),
          updated_at = now()
    where id = p_id
    returning id into v_id;
  else
    insert into public.carrier_accounts (company_id, scope, carrier_code, display_name, account_number, mode, credentials_secret_ref, data, is_active)
      values (p_company_id, p_scope, p_carrier_code, coalesce(p_display_name,''), coalesce(p_account_number,''),
              coalesce(p_mode,'test'), coalesce(p_credentials_secret_ref,''), coalesce(p_data,'{}'::jsonb), coalesce(p_is_active,true))
    returning id into v_id;
  end if;

  perform public.write_audit('carrier_account_upserted', 'carrier_accounts', v_id::text, null,
    jsonb_build_object('carrier', p_carrier_code, 'scope', p_scope), '');
  return v_id;
end; $$;
grant execute on function public.upsert_carrier_account(uuid, uuid, carrier_account_scope, text, text, text, text, text, jsonb, boolean) to authenticated;

-- Save rate quotes returned by an adapter (service-role typically; allow company members for own shipments)
create or replace function public.save_rate_quotes(p_shipment_id uuid, p_quotes jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare v_ship public.shipments; v_q record; v_count int := 0;
begin
  select * into v_ship from public.shipments where id = p_shipment_id;
  if v_ship is null then raise exception 'shipment not found'; end if;
  if not (public.is_member_of(v_ship.provider_company_id) or public.is_member_of(v_ship.customer_company_id) or public.is_admin()) then
    raise exception 'not authorized';
  end if;

  delete from public.shipping_rate_quotes where shipment_id = p_shipment_id;
  for v_q in
    select * from jsonb_to_recordset(p_quotes) as x(
      carrier_code text, service_level text, service_name text,
      rate_amount numeric, currency text, est_delivery_days int,
      est_delivery_date date, carrier_rate_id text, raw jsonb
    )
  loop
    insert into public.shipping_rate_quotes (shipment_id, requested_by, carrier_code, service_level, service_name,
      rate_amount, currency, est_delivery_days, est_delivery_date, carrier_rate_id, raw)
    values (p_shipment_id, auth.uid(), v_q.carrier_code, v_q.service_level, coalesce(v_q.service_name,''),
            coalesce(v_q.rate_amount,0), coalesce(v_q.currency,'CAD'), v_q.est_delivery_days,
            v_q.est_delivery_date, coalesce(v_q.carrier_rate_id,''), coalesce(v_q.raw,'{}'::jsonb));
    v_count := v_count + 1;
  end loop;

  return v_count;
end; $$;
grant execute on function public.save_rate_quotes(uuid, jsonb) to authenticated;

-- Open a manifest, attach shipments, return id
create or replace function public.open_manifest(p_company_id uuid, p_carrier_code text, p_carrier_account_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if not (public.is_member_of(p_company_id) or public.is_admin()) then raise exception 'not authorized'; end if;

  insert into public.shipping_manifests (company_id, carrier_code, carrier_account_id, status)
  values (p_company_id, p_carrier_code, p_carrier_account_id, 'Open')
  returning id into v_id;

  perform public.write_audit('manifest_opened', 'shipping_manifests', v_id::text, null,
    jsonb_build_object('carrier', p_carrier_code), '');
  return v_id;
end; $$;
grant execute on function public.open_manifest(uuid, text, uuid) to authenticated;

create or replace function public.attach_shipment_to_manifest(p_manifest_id uuid, p_shipment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_man public.shipping_manifests; v_ship public.shipments;
begin
  select * into v_man from public.shipping_manifests where id = p_manifest_id;
  if v_man is null then raise exception 'manifest not found'; end if;
  if v_man.status <> 'Open' then raise exception 'manifest not open'; end if;
  if not (public.is_member_of(v_man.company_id) or public.is_admin()) then raise exception 'not authorized'; end if;

  select * into v_ship from public.shipments where id = p_shipment_id;
  if v_ship is null then raise exception 'shipment not found'; end if;
  if v_ship.provider_company_id is distinct from v_man.company_id and not public.is_admin() then
    raise exception 'shipment not owned by manifest company';
  end if;
  if v_ship.status <> 'LabelPurchased' then raise exception 'only LabelPurchased shipments can be manifested'; end if;

  update public.shipments set manifest_id = p_manifest_id, updated_at = now() where id = p_shipment_id;
  update public.shipping_manifests
    set shipment_count = (select count(*) from public.shipments where manifest_id = p_manifest_id),
        updated_at = now()
    where id = p_manifest_id;
end; $$;
grant execute on function public.attach_shipment_to_manifest(uuid, uuid) to authenticated;

create or replace function public.close_manifest(p_manifest_id uuid, p_manifest_number text, p_manifest_url text, p_failed_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_man public.shipping_manifests;
begin
  select * into v_man from public.shipping_manifests where id = p_manifest_id;
  if v_man is null then raise exception 'manifest not found'; end if;
  if not (public.is_member_of(v_man.company_id) or public.is_admin()) then raise exception 'not authorized'; end if;

  if coalesce(p_failed_reason, '') <> '' then
    update public.shipping_manifests
      set status = 'Failed', failed_reason = p_failed_reason, updated_at = now()
      where id = p_manifest_id;
  else
    update public.shipping_manifests
      set status = 'Submitted',
          manifest_number = coalesce(p_manifest_number, manifest_number),
          manifest_url = coalesce(p_manifest_url, manifest_url),
          submitted_at = now(),
          updated_at = now()
      where id = p_manifest_id;
  end if;

  perform public.write_audit('manifest_closed', 'shipping_manifests', p_manifest_id::text, null,
    jsonb_build_object('failed', coalesce(p_failed_reason,'')), '');
end; $$;
grant execute on function public.close_manifest(uuid, text, text, text) to authenticated;
