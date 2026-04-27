-- 0020_sales_channels.sql
-- Sales channel integration: Shopify + Amazon SP-API
-- Tenant isolation via company_id; tokens stored encrypted (vault) or in private columns
-- with strict RLS (read by admin only). All mutations audit via write_audit().

-- =====================================================================
-- ENUMS
-- =====================================================================
do $$ begin
  create type sales_channel_kind as enum ('shopify', 'amazon');
exception when duplicate_object then null; end $$;

do $$ begin
  create type channel_connection_status as enum ('pending', 'active', 'expired', 'disconnected', 'error');
exception when duplicate_object then null; end $$;

do $$ begin
  create type channel_order_status as enum ('imported', 'allocated', 'picking', 'packed', 'shipped', 'fulfilled', 'cancelled', 'refunded', 'error');
exception when duplicate_object then null; end $$;

do $$ begin
  create type channel_sync_kind as enum ('orders_pull', 'product_pull', 'inventory_push', 'fulfillment_push', 'cancel_push', 'webhook');
exception when duplicate_object then null; end $$;

do $$ begin
  create type channel_sync_result as enum ('ok', 'partial', 'error');
exception when duplicate_object then null; end $$;

-- =====================================================================
-- TABLES
-- =====================================================================
create table if not exists sales_channels (
  id uuid primary key default gen_random_uuid(),
  kind sales_channel_kind not null,
  display_name text not null,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now()
);

insert into sales_channels (kind, display_name)
  select 'shopify', 'Shopify' where not exists (select 1 from sales_channels where kind = 'shopify');
insert into sales_channels (kind, display_name)
  select 'amazon', 'Amazon Seller Central' where not exists (select 1 from sales_channels where kind = 'amazon');

create table if not exists channel_connections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  channel_id uuid not null references sales_channels(id),
  kind sales_channel_kind not null,
  external_account_id text,           -- shop domain or selling-partner id
  display_label text,
  status channel_connection_status not null default 'pending',
  scope text,                         -- granted scopes
  -- secrets (RLS denies SELECT to non-admins; access through edge fns w/ service role)
  access_token_enc text,
  refresh_token_enc text,
  token_expires_at timestamptz,
  installed_by uuid references auth.users(id),
  metadata jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, kind, external_account_id)
);

create index if not exists idx_channel_conn_company on channel_connections (company_id);
create index if not exists idx_channel_conn_status on channel_connections (status);

create table if not exists channel_products (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references channel_connections(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  external_product_id text not null,
  external_variant_id text,
  sku text,
  title text,
  inventory_qty integer,
  raw jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (connection_id, external_product_id, external_variant_id)
);

create index if not exists idx_channel_products_company on channel_products (company_id);
create index if not exists idx_channel_products_sku on channel_products (sku);

create table if not exists sku_mappings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  connection_id uuid references channel_connections(id) on delete cascade,
  channel_sku text not null,
  internal_sku text not null,
  internal_variant_id uuid,
  notes text,
  created_at timestamptz not null default now(),
  unique (connection_id, channel_sku)
);

create index if not exists idx_sku_map_company on sku_mappings (company_id);

create table if not exists channel_orders (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references channel_connections(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  kind sales_channel_kind not null,
  external_order_id text not null,
  external_order_number text,
  status channel_order_status not null default 'imported',
  customer_name text,
  customer_email text,
  ship_to jsonb,
  total_amount numeric(12,2),
  currency text,
  ordered_at timestamptz,
  raw jsonb not null default '{}'::jsonb,
  fulfillment_order_id uuid,                 -- link into local fulfillment_orders once allocated
  shipment_id uuid,
  last_sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, external_order_id)
);

create index if not exists idx_channel_orders_company on channel_orders (company_id);
create index if not exists idx_channel_orders_status on channel_orders (status);

create table if not exists channel_order_items (
  id uuid primary key default gen_random_uuid(),
  channel_order_id uuid not null references channel_orders(id) on delete cascade,
  external_item_id text,
  external_sku text,
  internal_sku text,
  title text,
  quantity integer not null default 1,
  unit_price numeric(12,2),
  raw jsonb not null default '{}'::jsonb
);

create index if not exists idx_channel_order_items_order on channel_order_items (channel_order_id);

create table if not exists channel_sync_logs (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid references channel_connections(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  kind channel_sync_kind not null,
  result channel_sync_result not null default 'ok',
  message text,
  payload jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_channel_logs_conn on channel_sync_logs (connection_id);
create index if not exists idx_channel_logs_company on channel_sync_logs (company_id);
create index if not exists idx_channel_logs_started on channel_sync_logs (started_at desc);

-- =====================================================================
-- TIMESTAMPS
-- =====================================================================
create or replace function tg_touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists tr_channel_conn_touch on channel_connections;
create trigger tr_channel_conn_touch before update on channel_connections
  for each row execute function tg_touch_updated_at();

drop trigger if exists tr_channel_orders_touch on channel_orders;
create trigger tr_channel_orders_touch before update on channel_orders
  for each row execute function tg_touch_updated_at();

-- =====================================================================
-- RLS
-- =====================================================================
alter table sales_channels enable row level security;
alter table channel_connections enable row level security;
alter table channel_products enable row level security;
alter table sku_mappings enable row level security;
alter table channel_orders enable row level security;
alter table channel_order_items enable row level security;
alter table channel_sync_logs enable row level security;

drop policy if exists sales_channels_read on sales_channels;
create policy sales_channels_read on sales_channels for select to authenticated using (true);

-- channel_connections: members read NON-secret view; secrets via SECURITY DEFINER fns / service role
drop policy if exists chan_conn_read on channel_connections;
create policy chan_conn_read on channel_connections for select to authenticated
  using (is_member_of(company_id) or is_admin());

-- writes go through RPCs only — block direct insert/update/delete
drop policy if exists chan_conn_admin_write on channel_connections;
create policy chan_conn_admin_write on channel_connections for all to authenticated
  using (is_admin()) with check (is_admin());

drop policy if exists chan_products_member on channel_products;
create policy chan_products_member on channel_products for select to authenticated
  using (is_member_of(company_id) or is_admin());
drop policy if exists chan_products_admin on channel_products;
create policy chan_products_admin on channel_products for all to authenticated
  using (is_admin()) with check (is_admin());

drop policy if exists sku_map_member_read on sku_mappings;
create policy sku_map_member_read on sku_mappings for select to authenticated
  using (is_member_of(company_id) or is_admin());
drop policy if exists sku_map_member_write on sku_mappings;
create policy sku_map_member_write on sku_mappings for insert to authenticated
  with check (is_member_of(company_id));
drop policy if exists sku_map_member_update on sku_mappings;
create policy sku_map_member_update on sku_mappings for update to authenticated
  using (is_member_of(company_id)) with check (is_member_of(company_id));
drop policy if exists sku_map_member_delete on sku_mappings;
create policy sku_map_member_delete on sku_mappings for delete to authenticated
  using (is_member_of(company_id) or is_admin());

drop policy if exists chan_orders_read on channel_orders;
create policy chan_orders_read on channel_orders for select to authenticated
  using (is_member_of(company_id) or is_admin());
drop policy if exists chan_orders_admin on channel_orders;
create policy chan_orders_admin on channel_orders for all to authenticated
  using (is_admin()) with check (is_admin());

drop policy if exists chan_order_items_read on channel_order_items;
create policy chan_order_items_read on channel_order_items for select to authenticated
  using (
    exists (select 1 from channel_orders co where co.id = channel_order_id and (is_member_of(co.company_id) or is_admin()))
  );

drop policy if exists chan_logs_read on channel_sync_logs;
create policy chan_logs_read on channel_sync_logs for select to authenticated
  using (is_member_of(company_id) or is_admin());

-- =====================================================================
-- RPCs (member-callable)
-- =====================================================================

-- Start a connection (called by edge fn after OAuth begin to record intent).
create or replace function channel_connection_upsert(
  p_company_id uuid,
  p_kind sales_channel_kind,
  p_external_account_id text,
  p_display_label text,
  p_status channel_connection_status default 'pending'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_channel_id uuid;
  v_id uuid;
begin
  if not (is_member_of(p_company_id) or is_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select id into v_channel_id from sales_channels where kind = p_kind;
  if v_channel_id is null then
    raise exception 'unknown_channel_kind';
  end if;

  insert into channel_connections (company_id, channel_id, kind, external_account_id, display_label, status, installed_by)
  values (p_company_id, v_channel_id, p_kind, p_external_account_id, p_display_label, p_status, auth.uid())
  on conflict (company_id, kind, external_account_id) do update
    set display_label = excluded.display_label,
        status = excluded.status,
        updated_at = now()
  returning id into v_id;

  perform write_audit('channel_connection.upsert', 'channel_connection', v_id, null,
    jsonb_build_object('kind', p_kind, 'external', p_external_account_id, 'status', p_status), null);
  return v_id;
end $$;

grant execute on function channel_connection_upsert(uuid, sales_channel_kind, text, text, channel_connection_status) to authenticated;

-- Disconnect (members or admin). Tokens cleared, status -> disconnected.
create or replace function channel_connection_disconnect(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_company_id uuid;
begin
  select company_id into v_company_id from channel_connections where id = p_id;
  if v_company_id is null then raise exception 'not_found'; end if;
  if not (is_member_of(v_company_id) or is_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update channel_connections
    set status = 'disconnected',
        access_token_enc = null,
        refresh_token_enc = null,
        token_expires_at = null,
        last_error = p_reason,
        updated_at = now()
    where id = p_id;
  perform write_audit('channel_connection.disconnect', 'channel_connection', p_id, null,
    jsonb_build_object('reason', p_reason), p_reason);
end $$;

grant execute on function channel_connection_disconnect(uuid, text) to authenticated;

-- SKU mapping upsert
create or replace function sku_mapping_upsert(
  p_company_id uuid,
  p_connection_id uuid,
  p_channel_sku text,
  p_internal_sku text,
  p_internal_variant_id uuid default null,
  p_notes text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not (is_member_of(p_company_id) or is_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into sku_mappings (company_id, connection_id, channel_sku, internal_sku, internal_variant_id, notes)
  values (p_company_id, p_connection_id, p_channel_sku, p_internal_sku, p_internal_variant_id, p_notes)
  on conflict (connection_id, channel_sku) do update
    set internal_sku = excluded.internal_sku,
        internal_variant_id = excluded.internal_variant_id,
        notes = excluded.notes
  returning id into v_id;
  perform write_audit('sku_mapping.upsert', 'sku_mapping', v_id, null,
    jsonb_build_object('channel_sku', p_channel_sku, 'internal_sku', p_internal_sku), null);
  return v_id;
end $$;

grant execute on function sku_mapping_upsert(uuid, uuid, text, text, uuid, text) to authenticated;

-- Retry a failed sync (just queues a sync log row; channel-sync-worker picks it up).
create or replace function channel_retry_sync(p_connection_id uuid, p_kind channel_sync_kind)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_company_id uuid; v_log_id uuid;
begin
  select company_id into v_company_id from channel_connections where id = p_connection_id;
  if v_company_id is null then raise exception 'not_found'; end if;
  if not (is_member_of(v_company_id) or is_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into channel_sync_logs (connection_id, company_id, kind, result, message)
  values (p_connection_id, v_company_id, p_kind, 'ok', 'queued')
  returning id into v_log_id;
  return v_log_id;
end $$;

grant execute on function channel_retry_sync(uuid, channel_sync_kind) to authenticated;

-- Service-role-only: ingest channel order (called by edge fns after pulling from Shopify/Amazon).
create or replace function channel_ingest_order(
  p_connection_id uuid,
  p_company_id uuid,
  p_kind sales_channel_kind,
  p_external_order_id text,
  p_external_order_number text,
  p_customer_name text,
  p_customer_email text,
  p_ship_to jsonb,
  p_total numeric,
  p_currency text,
  p_ordered_at timestamptz,
  p_items jsonb,
  p_raw jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_order_id uuid; v_item jsonb;
begin
  -- service role only (auth.uid() will be null for service-role JWT)
  if auth.role() <> 'service_role' and not is_admin() then
    raise exception 'forbidden_service_role_only' using errcode = '42501';
  end if;

  insert into channel_orders (connection_id, company_id, kind, external_order_id, external_order_number,
    status, customer_name, customer_email, ship_to, total_amount, currency, ordered_at, raw)
  values (p_connection_id, p_company_id, p_kind, p_external_order_id, p_external_order_number,
    'imported', p_customer_name, p_customer_email, p_ship_to, p_total, p_currency, p_ordered_at, coalesce(p_raw, '{}'::jsonb))
  on conflict (connection_id, external_order_id) do update
    set updated_at = now(),
        raw = excluded.raw
  returning id into v_order_id;

  -- replace items
  delete from channel_order_items where channel_order_id = v_order_id;
  if p_items is not null then
    for v_item in select * from jsonb_array_elements(p_items) loop
      insert into channel_order_items (channel_order_id, external_item_id, external_sku, title, quantity, unit_price, raw)
      values (v_order_id,
        v_item->>'external_item_id',
        v_item->>'sku',
        v_item->>'title',
        coalesce((v_item->>'quantity')::int, 1),
        nullif(v_item->>'unit_price', '')::numeric,
        coalesce(v_item->'raw', '{}'::jsonb));
    end loop;
  end if;

  -- fold internal_sku via mappings
  update channel_order_items i
    set internal_sku = m.internal_sku
    from sku_mappings m
    where i.channel_order_id = v_order_id
      and m.connection_id = p_connection_id
      and m.channel_sku = i.external_sku
      and i.internal_sku is null;

  return v_order_id;
end $$;

grant execute on function channel_ingest_order(uuid, uuid, sales_channel_kind, text, text, text, text, jsonb, numeric, text, timestamptz, jsonb, jsonb) to service_role;

-- Service-role-only: log a sync result.
create or replace function channel_log_sync(
  p_connection_id uuid,
  p_company_id uuid,
  p_kind channel_sync_kind,
  p_result channel_sync_result,
  p_message text,
  p_payload jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.role() <> 'service_role' and not is_admin() then
    raise exception 'forbidden_service_role_only' using errcode = '42501';
  end if;
  insert into channel_sync_logs (connection_id, company_id, kind, result, message, payload, finished_at)
  values (p_connection_id, p_company_id, p_kind, p_result, p_message, coalesce(p_payload, '{}'::jsonb), now())
  returning id into v_id;

  if p_connection_id is not null then
    update channel_connections
      set last_synced_at = now(),
          last_error = case when p_result = 'error' then p_message else null end,
          status = case when p_result = 'error' then 'error'::channel_connection_status
                        else status end,
          updated_at = now()
      where id = p_connection_id;
  end if;
  return v_id;
end $$;

grant execute on function channel_log_sync(uuid, uuid, channel_sync_kind, channel_sync_result, text, jsonb) to service_role;

-- Public list view (no secrets).
create or replace view channel_connections_public as
  select id, company_id, channel_id, kind, external_account_id, display_label, status, scope,
         metadata, last_synced_at, last_error, created_at, updated_at
  from channel_connections;

grant select on channel_connections_public to authenticated;
