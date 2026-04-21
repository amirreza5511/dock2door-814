-- Dock2Door — additional tables for inventory, fleet, fulfillment, messaging, admin
-- Run in Supabase SQL editor after 0001_init.sql.

-- =========================================================================
-- INVENTORY
-- =========================================================================
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  name text not null,
  description text default '',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_products_company on public.products(company_id);

create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  sku text not null,
  barcode text,
  name text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_variants_product on public.product_variants(product_id);

-- =========================================================================
-- FULFILLMENT / ORDERS
-- =========================================================================
do $$ begin
  create type order_status as enum (
    'Draft','Received','Picking','Packed','Shipped','Completed','Cancelled'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.fulfillment_orders (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references public.warehouse_bookings(id) on delete set null,
  customer_company_id uuid references public.companies(id) on delete cascade,
  provider_company_id uuid references public.companies(id) on delete set null,
  reference_code text default '',
  status order_status not null default 'Draft',
  ship_to_name text default '',
  ship_to_address text default '',
  ship_to_city text default '',
  notes text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_orders_customer on public.fulfillment_orders(customer_company_id);
create index if not exists idx_orders_provider on public.fulfillment_orders(provider_company_id);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.fulfillment_orders(id) on delete cascade,
  variant_id uuid references public.product_variants(id) on delete set null,
  sku text default '',
  name text default '',
  quantity int not null default 1
);

create table if not exists public.booking_inventory (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.warehouse_bookings(id) on delete cascade,
  variant_id uuid references public.product_variants(id) on delete set null,
  sku text default '',
  name text default '',
  quantity int not null default 0,
  created_at timestamptz not null default now()
);

-- =========================================================================
-- MESSAGING THREADS
-- =========================================================================
do $$ begin
  create type thread_scope as enum ('Booking','Appointment','Dispute','Direct','Internal');
exception when duplicate_object then null; end $$;

create table if not exists public.chat_threads (
  id uuid primary key default gen_random_uuid(),
  scope thread_scope not null default 'Direct',
  booking_id uuid references public.warehouse_bookings(id) on delete set null,
  company_id uuid references public.companies(id) on delete set null,
  subject text default '',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.thread_participants (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.chat_threads(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz,
  unique (thread_id, user_id)
);

create table if not exists public.thread_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.chat_threads(id) on delete cascade,
  sender_user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  attachments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- =========================================================================
-- FLEET
-- =========================================================================
do $$ begin
  create type fleet_status as enum ('Active','Maintenance','Retired','Suspended');
exception when duplicate_object then null; end $$;

create table if not exists public.drivers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  name text not null,
  license_number text default '',
  phone text default '',
  status fleet_status not null default 'Active',
  data jsonb not null default '{}'::jsonb,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.trucks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  plate text not null,
  make text default '',
  model text default '',
  year int,
  status fleet_status not null default 'Active',
  data jsonb not null default '{}'::jsonb,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.trailers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  plate text not null,
  trailer_type text default '',
  status fleet_status not null default 'Active',
  data jsonb not null default '{}'::jsonb,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.containers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  container_number text not null,
  container_type text default '',
  status fleet_status not null default 'Active',
  data jsonb not null default '{}'::jsonb,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =========================================================================
-- DOCK APPOINTMENTS
-- =========================================================================
do $$ begin
  create type appointment_status as enum (
    'Requested','Approved','CheckedIn','Completed','NoShow','Cancelled'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.dock_appointments (
  id uuid primary key default gen_random_uuid(),
  warehouse_listing_id uuid references public.warehouse_listings(id) on delete set null,
  booking_id uuid references public.warehouse_bookings(id) on delete set null,
  trucking_company_id uuid references public.companies(id) on delete set null,
  scheduled_start timestamptz not null,
  scheduled_end timestamptz not null,
  dock_door text default '',
  truck_plate text default '',
  driver_name text default '',
  appointment_type text default 'Inbound',
  pallet_count int not null default 0,
  pod_file text default '',
  status appointment_status not null default 'Requested',
  check_in_ts timestamptz,
  check_out_ts timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =========================================================================
-- PAYOUTS
-- =========================================================================
do $$ begin
  create type payout_status as enum ('Pending','Processing','Paid','Failed','Cancelled');
exception when duplicate_object then null; end $$;

create table if not exists public.payouts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  payment_id uuid references public.payments(id) on delete set null,
  gross_amount numeric not null default 0,
  commission_amount numeric not null default 0,
  net_amount numeric not null default 0,
  status payout_status not null default 'Pending',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =========================================================================
-- AUDIT LOGS
-- =========================================================================
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.profiles(id) on delete set null,
  company_id uuid references public.companies(id) on delete set null,
  action text not null,
  entity text not null,
  entity_id text,
  previous_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_audit_actor on public.audit_logs(actor_user_id);
create index if not exists idx_audit_company on public.audit_logs(company_id);
create index if not exists idx_audit_entity on public.audit_logs(entity, entity_id);

-- =========================================================================
-- ADMIN RULES / FLAGS
-- =========================================================================
create table if not exists public.commission_rules (
  id uuid primary key default gen_random_uuid(),
  scope text not null,
  role text,
  percentage numeric not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tax_rules (
  id uuid primary key default gen_random_uuid(),
  region text not null,
  name text not null,
  percentage numeric not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.feature_flags (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  description text default '',
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =========================================================================
-- RLS — enable and create baseline policies
-- =========================================================================
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.fulfillment_orders enable row level security;
alter table public.order_items enable row level security;
alter table public.booking_inventory enable row level security;
alter table public.chat_threads enable row level security;
alter table public.thread_participants enable row level security;
alter table public.thread_messages enable row level security;
alter table public.drivers enable row level security;
alter table public.trucks enable row level security;
alter table public.trailers enable row level security;
alter table public.containers enable row level security;
alter table public.dock_appointments enable row level security;
alter table public.payouts enable row level security;
alter table public.audit_logs enable row level security;
alter table public.commission_rules enable row level security;
alter table public.tax_rules enable row level security;
alter table public.feature_flags enable row level security;

-- products: company-scoped, admin full
drop policy if exists "products_company_access" on public.products;
create policy "products_company_access" on public.products for all
  using (public.is_admin() or company_id = public.my_company_id())
  with check (public.is_admin() or company_id = public.my_company_id());

drop policy if exists "variants_via_product" on public.product_variants;
create policy "variants_via_product" on public.product_variants for all
  using (public.is_admin() or exists (
    select 1 from public.products p where p.id = product_variants.product_id and p.company_id = public.my_company_id()
  ))
  with check (public.is_admin() or exists (
    select 1 from public.products p where p.id = product_variants.product_id and p.company_id = public.my_company_id()
  ));

-- orders: customer or provider
drop policy if exists "orders_parties" on public.fulfillment_orders;
create policy "orders_parties" on public.fulfillment_orders for all
  using (
    public.is_admin()
    or customer_company_id = public.my_company_id()
    or provider_company_id = public.my_company_id()
  )
  with check (
    public.is_admin()
    or customer_company_id = public.my_company_id()
    or provider_company_id = public.my_company_id()
  );

drop policy if exists "order_items_via_order" on public.order_items;
create policy "order_items_via_order" on public.order_items for all
  using (public.is_admin() or exists (
    select 1 from public.fulfillment_orders o
    where o.id = order_items.order_id
      and (o.customer_company_id = public.my_company_id() or o.provider_company_id = public.my_company_id())
  ))
  with check (public.is_admin() or exists (
    select 1 from public.fulfillment_orders o
    where o.id = order_items.order_id
      and (o.customer_company_id = public.my_company_id() or o.provider_company_id = public.my_company_id())
  ));

drop policy if exists "booking_inv_via_booking" on public.booking_inventory;
create policy "booking_inv_via_booking" on public.booking_inventory for all
  using (public.is_admin() or exists (
    select 1 from public.warehouse_bookings b
    where b.id = booking_inventory.booking_id
      and (b.customer_company_id = public.my_company_id() or exists (
        select 1 from public.warehouse_listings wl where wl.id = b.listing_id and wl.company_id = public.my_company_id()
      ))
  ))
  with check (public.is_admin() or exists (
    select 1 from public.warehouse_bookings b
    where b.id = booking_inventory.booking_id
      and (b.customer_company_id = public.my_company_id() or exists (
        select 1 from public.warehouse_listings wl where wl.id = b.listing_id and wl.company_id = public.my_company_id()
      ))
  ));

-- threads & messages
drop policy if exists "threads_participant" on public.chat_threads;
create policy "threads_participant" on public.chat_threads for all
  using (
    public.is_admin()
    or created_by = auth.uid()
    or exists (select 1 from public.thread_participants tp where tp.thread_id = chat_threads.id and tp.user_id = auth.uid())
  )
  with check (created_by = auth.uid() or public.is_admin());

drop policy if exists "tp_self" on public.thread_participants;
create policy "tp_self" on public.thread_participants for all
  using (public.is_admin() or user_id = auth.uid() or exists (
    select 1 from public.chat_threads t where t.id = thread_participants.thread_id and t.created_by = auth.uid()
  ))
  with check (public.is_admin() or user_id = auth.uid() or exists (
    select 1 from public.chat_threads t where t.id = thread_participants.thread_id and t.created_by = auth.uid()
  ));

drop policy if exists "tm_via_thread" on public.thread_messages;
create policy "tm_via_thread" on public.thread_messages for all
  using (public.is_admin() or exists (
    select 1 from public.thread_participants tp where tp.thread_id = thread_messages.thread_id and tp.user_id = auth.uid()
  ))
  with check (
    sender_user_id = auth.uid() and exists (
      select 1 from public.thread_participants tp where tp.thread_id = thread_messages.thread_id and tp.user_id = auth.uid()
    )
  );

-- fleet: company-scoped
drop policy if exists "drivers_company" on public.drivers;
create policy "drivers_company" on public.drivers for all
  using (public.is_admin() or company_id = public.my_company_id())
  with check (public.is_admin() or company_id = public.my_company_id());

drop policy if exists "trucks_company" on public.trucks;
create policy "trucks_company" on public.trucks for all
  using (public.is_admin() or company_id = public.my_company_id())
  with check (public.is_admin() or company_id = public.my_company_id());

drop policy if exists "trailers_company" on public.trailers;
create policy "trailers_company" on public.trailers for all
  using (public.is_admin() or company_id = public.my_company_id())
  with check (public.is_admin() or company_id = public.my_company_id());

drop policy if exists "containers_company" on public.containers;
create policy "containers_company" on public.containers for all
  using (public.is_admin() or company_id = public.my_company_id())
  with check (public.is_admin() or company_id = public.my_company_id());

-- dock_appointments: visible to warehouse & trucking parties
drop policy if exists "dock_app_parties" on public.dock_appointments;
create policy "dock_app_parties" on public.dock_appointments for all
  using (
    public.is_admin()
    or trucking_company_id = public.my_company_id()
    or exists (select 1 from public.warehouse_listings wl where wl.id = dock_appointments.warehouse_listing_id and wl.company_id = public.my_company_id())
  )
  with check (
    public.is_admin()
    or trucking_company_id = public.my_company_id()
    or exists (select 1 from public.warehouse_listings wl where wl.id = dock_appointments.warehouse_listing_id and wl.company_id = public.my_company_id())
  );

-- payouts
drop policy if exists "payouts_company" on public.payouts;
create policy "payouts_company" on public.payouts for select
  using (public.is_admin() or company_id = public.my_company_id());

drop policy if exists "payouts_admin_write" on public.payouts;
create policy "payouts_admin_write" on public.payouts for all
  using (public.is_admin()) with check (public.is_admin());

-- audit_logs
drop policy if exists "audit_read" on public.audit_logs;
create policy "audit_read" on public.audit_logs for select
  using (public.is_admin() or company_id = public.my_company_id() or actor_user_id = auth.uid());

drop policy if exists "audit_insert_self" on public.audit_logs;
create policy "audit_insert_self" on public.audit_logs for insert
  with check (actor_user_id = auth.uid() or public.is_admin());

-- admin rules
drop policy if exists "cr_read" on public.commission_rules;
create policy "cr_read" on public.commission_rules for select using (auth.role() = 'authenticated');
drop policy if exists "cr_admin" on public.commission_rules;
create policy "cr_admin" on public.commission_rules for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "tr_read" on public.tax_rules;
create policy "tr_read" on public.tax_rules for select using (auth.role() = 'authenticated');
drop policy if exists "tr_admin" on public.tax_rules;
create policy "tr_admin" on public.tax_rules for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "ff_read" on public.feature_flags;
create policy "ff_read" on public.feature_flags for select using (auth.role() = 'authenticated');
drop policy if exists "ff_admin" on public.feature_flags;
create policy "ff_admin" on public.feature_flags for all using (public.is_admin()) with check (public.is_admin());

-- =========================================================================
-- warehouse_bookings: counter-offer columns used by UI
-- =========================================================================
alter table public.warehouse_bookings
  add column if not exists pending_counter_offer_id uuid;
