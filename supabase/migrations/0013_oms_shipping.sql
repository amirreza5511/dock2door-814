-- Dock2Door — OMS hardening + Shipping / Carrier Integrations
-- Shipments, packages, tracking events, carrier accounts, return authorizations.
-- Idempotent.

-- =========================================================================
-- ENUMS
-- =========================================================================
do $$ begin
  create type shipment_status as enum (
    'Draft','LabelPurchased','InTransit','OutForDelivery','Delivered','Exception','Returned','Cancelled'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type return_status as enum ('Requested','Approved','Rejected','Received','Refunded','Closed');
exception when duplicate_object then null; end $$;

-- =========================================================================
-- CARRIER ACCOUNTS (per provider company)
-- =========================================================================
create table if not exists public.carrier_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  carrier_code text not null,
  display_name text default '',
  account_number text default '',
  api_key_ref text default '',
  is_active boolean not null default true,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, carrier_code, account_number)
);
alter table public.carrier_accounts enable row level security;

drop policy if exists "carrier_accounts_read" on public.carrier_accounts;
create policy "carrier_accounts_read" on public.carrier_accounts for select using (public.is_member_of(company_id) or public.is_admin());
drop policy if exists "carrier_accounts_write" on public.carrier_accounts;
create policy "carrier_accounts_write" on public.carrier_accounts for all
  using (public.is_member_of(company_id)) with check (public.is_member_of(company_id));

-- =========================================================================
-- SHIPMENTS
-- =========================================================================
create table if not exists public.shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.fulfillment_orders(id) on delete set null,
  booking_id uuid references public.warehouse_bookings(id) on delete set null,
  customer_company_id uuid references public.companies(id) on delete set null,
  provider_company_id uuid references public.companies(id) on delete set null,
  carrier_code text default '',
  carrier_account_id uuid references public.carrier_accounts(id) on delete set null,
  service_level text default '',
  tracking_code text default '',
  label_path text default '',
  label_url text default '',
  status shipment_status not null default 'Draft',
  ship_from jsonb not null default '{}'::jsonb,
  ship_to jsonb not null default '{}'::jsonb,
  weight_kg numeric default 0,
  length_cm numeric default 0,
  width_cm numeric default 0,
  height_cm numeric default 0,
  rate_amount numeric default 0,
  currency text default 'CAD',
  purchased_at timestamptz,
  shipped_at timestamptz,
  delivered_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_shipments_order on public.shipments(order_id);
create index if not exists idx_shipments_tracking on public.shipments(tracking_code);
create index if not exists idx_shipments_customer on public.shipments(customer_company_id);
create index if not exists idx_shipments_provider on public.shipments(provider_company_id);
alter table public.shipments enable row level security;

drop policy if exists "shipments_read" on public.shipments;
create policy "shipments_read" on public.shipments for select using (
  public.is_member_of(customer_company_id) or public.is_member_of(provider_company_id) or public.is_admin()
);
drop policy if exists "shipments_write_provider" on public.shipments;
create policy "shipments_write_provider" on public.shipments for all
  using (public.is_member_of(provider_company_id) or public.is_admin())
  with check (public.is_member_of(provider_company_id) or public.is_admin());

-- =========================================================================
-- SHIPMENT PACKAGES
-- =========================================================================
create table if not exists public.shipment_packages (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  reference text default '',
  weight_kg numeric default 0,
  length_cm numeric default 0,
  width_cm numeric default 0,
  height_cm numeric default 0,
  tracking_code text default '',
  created_at timestamptz not null default now()
);
alter table public.shipment_packages enable row level security;
drop policy if exists "pkg_read" on public.shipment_packages;
create policy "pkg_read" on public.shipment_packages for select using (
  exists (select 1 from public.shipments s where s.id = shipment_packages.shipment_id
          and (public.is_member_of(s.customer_company_id) or public.is_member_of(s.provider_company_id) or public.is_admin()))
);

-- =========================================================================
-- TRACKING EVENTS (from carrier webhooks)
-- =========================================================================
create table if not exists public.tracking_events (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  event_code text default '',
  description text default '',
  status text default '',
  city text default '',
  region text default '',
  country text default '',
  occurred_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_tracking_shipment on public.tracking_events(shipment_id, occurred_at desc);
alter table public.tracking_events enable row level security;
drop policy if exists "tracking_read" on public.tracking_events;
create policy "tracking_read" on public.tracking_events for select using (
  exists (select 1 from public.shipments s where s.id = tracking_events.shipment_id
          and (public.is_member_of(s.customer_company_id) or public.is_member_of(s.provider_company_id) or public.is_admin()))
);

-- =========================================================================
-- RETURN AUTHORIZATIONS
-- =========================================================================
create table if not exists public.return_authorizations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.fulfillment_orders(id) on delete cascade,
  customer_company_id uuid references public.companies(id) on delete set null,
  provider_company_id uuid references public.companies(id) on delete set null,
  rma_number text,
  reason text default '',
  status return_status not null default 'Requested',
  requested_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  received_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_rma_order on public.return_authorizations(order_id);
alter table public.return_authorizations enable row level security;

drop policy if exists "rma_read" on public.return_authorizations;
create policy "rma_read" on public.return_authorizations for select using (
  public.is_member_of(customer_company_id) or public.is_member_of(provider_company_id) or public.is_admin()
);
drop policy if exists "rma_insert_customer" on public.return_authorizations;
create policy "rma_insert_customer" on public.return_authorizations for insert
  with check (public.is_member_of(customer_company_id));
drop policy if exists "rma_update_parties" on public.return_authorizations;
create policy "rma_update_parties" on public.return_authorizations for update
  using (public.is_member_of(customer_company_id) or public.is_member_of(provider_company_id) or public.is_admin())
  with check (public.is_member_of(customer_company_id) or public.is_member_of(provider_company_id) or public.is_admin());

create table if not exists public.return_items (
  id uuid primary key default gen_random_uuid(),
  rma_id uuid not null references public.return_authorizations(id) on delete cascade,
  order_item_id uuid references public.order_items(id) on delete set null,
  variant_id uuid references public.product_variants(id) on delete set null,
  quantity int not null default 1,
  reason text default '',
  received_qty int not null default 0
);
alter table public.return_items enable row level security;
drop policy if exists "ri_read" on public.return_items;
create policy "ri_read" on public.return_items for select using (
  exists (select 1 from public.return_authorizations r where r.id = return_items.rma_id
          and (public.is_member_of(r.customer_company_id) or public.is_member_of(r.provider_company_id) or public.is_admin()))
);

-- =========================================================================
-- RPCs — shipping
-- =========================================================================

-- Create a shipment for an order (provider only)
create or replace function public.create_shipment_for_order(
  p_order_id uuid,
  p_carrier_code text,
  p_service_level text,
  p_ship_to jsonb,
  p_ship_from jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_order public.fulfillment_orders; v_id uuid;
begin
  select * into v_order from public.fulfillment_orders where id = p_order_id;
  if v_order is null then raise exception 'order not found'; end if;
  if not (public.is_member_of(v_order.provider_company_id) or public.is_admin()) then
    raise exception 'only provider can create shipment';
  end if;

  insert into public.shipments (order_id, customer_company_id, provider_company_id, carrier_code, service_level, ship_to, ship_from, status)
  values (p_order_id, v_order.customer_company_id, v_order.provider_company_id, p_carrier_code, p_service_level,
          coalesce(p_ship_to, '{}'::jsonb), coalesce(p_ship_from, '{}'::jsonb), 'Draft')
  returning id into v_id;

  perform public.write_audit('shipment_created', 'shipments', v_id::text, null,
    jsonb_build_object('order', p_order_id, 'carrier', p_carrier_code), '');
  return v_id;
end; $$;
grant execute on function public.create_shipment_for_order(uuid, text, text, jsonb, jsonb) to authenticated;

-- Attach label (after carrier label purchase)
create or replace function public.attach_shipment_label(
  p_shipment_id uuid, p_tracking text, p_label_path text, p_rate numeric, p_currency text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_ship public.shipments;
begin
  select * into v_ship from public.shipments where id = p_shipment_id;
  if v_ship is null then raise exception 'shipment not found'; end if;
  if not (public.is_member_of(v_ship.provider_company_id) or public.is_admin()) then raise exception 'not authorized'; end if;

  update public.shipments
    set tracking_code = p_tracking,
        label_path = p_label_path,
        rate_amount = coalesce(p_rate, 0),
        currency = coalesce(p_currency, currency),
        status = 'LabelPurchased',
        purchased_at = now(),
        updated_at = now()
  where id = p_shipment_id;

  perform public.write_audit('shipment_label_attached', 'shipments', p_shipment_id::text, null,
    jsonb_build_object('tracking', p_tracking, 'rate', p_rate), '');
end; $$;
grant execute on function public.attach_shipment_label(uuid, text, text, numeric, text) to authenticated;

-- Record tracking event (service-role via tracking-webhook Edge Function)
create or replace function public.record_tracking_event(
  p_tracking text, p_event_code text, p_description text, p_status text, p_occurred timestamptz, p_payload jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_ship_id uuid; v_event_id uuid;
begin
  select id into v_ship_id from public.shipments where tracking_code = p_tracking order by created_at desc limit 1;
  if v_ship_id is null then raise exception 'shipment % not found', p_tracking; end if;

  insert into public.tracking_events (shipment_id, event_code, description, status, occurred_at, payload)
    values (v_ship_id, p_event_code, coalesce(p_description, ''), coalesce(p_status, ''), coalesce(p_occurred, now()), coalesce(p_payload, '{}'::jsonb))
  returning id into v_event_id;

  -- Update shipment status
  if p_status = 'Delivered' then
    update public.shipments set status = 'Delivered', delivered_at = coalesce(p_occurred, now()), updated_at = now() where id = v_ship_id;
  elsif p_status = 'OutForDelivery' then
    update public.shipments set status = 'OutForDelivery', updated_at = now() where id = v_ship_id and status <> 'Delivered';
  elsif p_status = 'InTransit' then
    update public.shipments set status = 'InTransit', shipped_at = coalesce(shipped_at, p_occurred, now()), updated_at = now() where id = v_ship_id and status not in ('Delivered','OutForDelivery');
  elsif p_status in ('Exception','Returned') then
    update public.shipments set status = p_status::shipment_status, updated_at = now() where id = v_ship_id;
  end if;

  return v_event_id;
end; $$;
revoke execute on function public.record_tracking_event(text, text, text, text, timestamptz, jsonb) from public, authenticated;

-- Request RMA (customer)
create or replace function public.request_rma(p_order_id uuid, p_reason text, p_items jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_order public.fulfillment_orders; v_id uuid; v_rma_num text; v_it record;
begin
  perform public.require_reason(p_reason);
  select * into v_order from public.fulfillment_orders where id = p_order_id;
  if v_order is null then raise exception 'order not found'; end if;
  if not public.is_member_of(v_order.customer_company_id) then raise exception 'not authorized'; end if;

  v_rma_num := 'RMA-' || to_char(now(), 'YYYYMMDD') || '-' || substr(gen_random_uuid()::text, 1, 6);
  insert into public.return_authorizations (order_id, customer_company_id, provider_company_id, rma_number, reason, requested_by)
    values (p_order_id, v_order.customer_company_id, v_order.provider_company_id, v_rma_num, p_reason, auth.uid())
  returning id into v_id;

  for v_it in select * from jsonb_to_recordset(p_items) as x(order_item_id uuid, quantity int, reason text) loop
    insert into public.return_items (rma_id, order_item_id, quantity, reason)
      values (v_id, v_it.order_item_id, coalesce(v_it.quantity, 1), coalesce(v_it.reason, ''));
  end loop;

  perform public.write_audit('rma_requested', 'return_authorizations', v_id::text, null,
    jsonb_build_object('order', p_order_id), p_reason);
  return v_id;
end; $$;
grant execute on function public.request_rma(uuid, text, jsonb) to authenticated;
