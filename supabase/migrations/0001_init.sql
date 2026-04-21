-- Dock2Door — Supabase initial schema
-- Run this in the Supabase SQL editor.

-- =========================================================================
-- EXTENSIONS
-- =========================================================================
create extension if not exists "pgcrypto";

-- =========================================================================
-- ENUMS
-- =========================================================================
do $$ begin
  create type user_role as enum (
    'Customer','WarehouseProvider','ServiceProvider','Employer','Worker',
    'TruckingCompany','Driver','GateStaff','Admin','SuperAdmin'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type company_type as enum (
    'Customer','WarehouseProvider','ServiceProvider','Employer','TruckingCompany'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type company_status as enum ('PendingApproval','Approved','Suspended');
exception when duplicate_object then null; end $$;

do $$ begin
  create type company_role as enum ('Owner','Staff');
exception when duplicate_object then null; end $$;

do $$ begin
  create type active_status as enum ('Active','Suspended','Inactive');
exception when duplicate_object then null; end $$;

do $$ begin
  create type warehouse_type as enum ('Dry','Chill','Frozen');
exception when duplicate_object then null; end $$;

do $$ begin
  create type storage_term as enum ('Daily','Weekly','Monthly');
exception when duplicate_object then null; end $$;

do $$ begin
  create type listing_status as enum (
    'Draft','PendingApproval','Available','Active','Hidden','Suspended'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type booking_status as enum (
    'Requested','Accepted','CounterOffered','Confirmed','InProgress','Completed','Cancelled'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_status as enum ('Pending','Paid','Refunded');
exception when duplicate_object then null; end $$;

do $$ begin
  create type service_category as enum (
    'Labour','Forklift','PalletRework','Devanning','LocalTruck','IndustrialCleaning'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type job_status as enum (
    'Requested','Accepted','Scheduled','InProgress','Completed','Cancelled'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type shift_category as enum ('General','Driver','Forklift','HighReach');
exception when duplicate_object then null; end $$;

do $$ begin
  create type shift_status as enum (
    'Draft','Posted','Filled','InProgress','Completed','Cancelled'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type application_status as enum ('Applied','Accepted','Rejected','Withdrawn');
exception when duplicate_object then null; end $$;

do $$ begin
  create type assignment_status as enum (
    'Scheduled','InProgress','Completed','NoShow','Cancelled','Disputed'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type dispute_status as enum ('Open','UnderReview','Resolved');
exception when duplicate_object then null; end $$;

do $$ begin
  create type dispute_outcome as enum ('Refund','PartialRefund','Denied','Other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type review_type as enum (
    'WarehouseListing','ServiceProviderCompany','Worker','EmployerCompany'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type reference_type as enum (
    'WarehouseBooking','ServiceJob','ShiftAssignment'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type notification_kind as enum (
    'booking','service','shift','system','dispute'
  );
exception when duplicate_object then null; end $$;

-- =========================================================================
-- TABLES
-- =========================================================================

-- companies
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type company_type not null,
  address text default '',
  city text default '',
  status company_status not null default 'PendingApproval',
  created_at timestamptz not null default now()
);

-- profiles (1:1 with auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text not null default '',
  role user_role not null default 'Customer',
  company_id uuid references public.companies(id) on delete set null,
  status active_status not null default 'Active',
  email_verified boolean default false,
  two_factor_enabled boolean default false,
  profile_image text,
  last_login_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_profiles_company on public.profiles(company_id);
create index if not exists idx_profiles_role on public.profiles(role);

-- company_users
create table if not exists public.company_users (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  company_role company_role not null default 'Staff',
  status active_status not null default 'Active',
  unique (company_id, user_id)
);

-- platform_settings
create table if not exists public.platform_settings (
  id uuid primary key default gen_random_uuid(),
  warehouse_commission_percentage numeric not null default 8,
  service_commission_percentage numeric not null default 20,
  labour_commission_percentage numeric not null default 15,
  handling_fee_per_pallet_default numeric not null default 12,
  tax_mode text not null default 'GST+PST',
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

-- warehouse_listings
create table if not exists public.warehouse_listings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  address text default '',
  city text default '',
  geo_lat numeric,
  geo_lng numeric,
  warehouse_type warehouse_type not null,
  available_pallet_capacity int not null default 0,
  min_pallets int not null default 1,
  max_pallets int not null default 100,
  storage_term storage_term not null default 'Monthly',
  storage_rate_per_pallet numeric not null default 0,
  inbound_handling_fee_per_pallet numeric not null default 0,
  outbound_handling_fee_per_pallet numeric not null default 0,
  receiving_hours text default '',
  access_restrictions text default '',
  insurance_requirements text default '',
  notes text default '',
  status listing_status not null default 'Draft',
  photos text[] not null default '{}',
  created_at timestamptz not null default now()
);

-- warehouse_bookings
create table if not exists public.warehouse_bookings (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.warehouse_listings(id) on delete cascade,
  customer_company_id uuid not null references public.companies(id) on delete cascade,
  pallets_requested int not null,
  start_date date not null,
  end_date date not null,
  handling_required boolean not null default false,
  customer_notes text default '',
  provider_response_notes text default '',
  proposed_price numeric not null default 0,
  counter_offer_price numeric,
  final_price numeric,
  status booking_status not null default 'Requested',
  payment_status payment_status not null default 'Pending',
  created_at timestamptz not null default now()
);

-- service_listings
create table if not exists public.service_listings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  category service_category not null,
  coverage_area text[] not null default '{}',
  hourly_rate numeric not null default 0,
  per_job_rate numeric,
  minimum_hours int not null default 1,
  certifications text default '',
  status listing_status not null default 'Draft',
  created_at timestamptz not null default now()
);

-- service_jobs
create table if not exists public.service_jobs (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.service_listings(id) on delete cascade,
  customer_company_id uuid not null references public.companies(id) on delete cascade,
  location_address text default '',
  location_city text default '',
  date_time_start timestamptz not null,
  duration_hours numeric not null default 1,
  notes text default '',
  total_price numeric not null default 0,
  status job_status not null default 'Requested',
  payment_status payment_status not null default 'Pending',
  check_in_ts timestamptz,
  check_out_ts timestamptz,
  customer_confirmed boolean not null default false,
  created_at timestamptz not null default now()
);

-- worker_profiles
create table if not exists public.worker_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  display_name text not null,
  skills shift_category[] not null default '{}',
  coverage_cities text[] not null default '{}',
  hourly_expectation numeric not null default 0,
  verified boolean not null default false,
  status active_status not null default 'Active',
  bio text default '',
  created_at timestamptz not null default now()
);

-- worker_certifications
create table if not exists public.worker_certifications (
  id uuid primary key default gen_random_uuid(),
  worker_user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  expiry_date date,
  certificate_file text default '',
  admin_approved boolean not null default false
);

-- shift_posts
create table if not exists public.shift_posts (
  id uuid primary key default gen_random_uuid(),
  employer_company_id uuid not null references public.companies(id) on delete cascade,
  title text not null,
  category shift_category not null,
  location_address text default '',
  location_city text default '',
  date date not null,
  start_time text not null,
  end_time text not null,
  hourly_rate numeric,
  flat_rate numeric,
  minimum_hours int not null default 1,
  workers_needed int not null default 1,
  requirements text default '',
  notes text default '',
  status shift_status not null default 'Draft',
  created_at timestamptz not null default now()
);

-- shift_applications
create table if not exists public.shift_applications (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shift_posts(id) on delete cascade,
  worker_user_id uuid not null references public.profiles(id) on delete cascade,
  status application_status not null default 'Applied',
  applied_at timestamptz not null default now(),
  unique (shift_id, worker_user_id)
);

-- shift_assignments
create table if not exists public.shift_assignments (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shift_posts(id) on delete cascade,
  worker_user_id uuid not null references public.profiles(id) on delete cascade,
  confirmed_rate numeric not null default 0,
  status assignment_status not null default 'Scheduled',
  created_at timestamptz not null default now()
);

-- time_entries
create table if not exists public.time_entries (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.shift_assignments(id) on delete cascade,
  start_timestamp timestamptz,
  end_timestamp timestamptz,
  employer_confirmed_hours numeric,
  employer_notes text default ''
);

-- payments
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  reference_type reference_type not null,
  reference_id uuid not null,
  gross_amount numeric not null default 0,
  commission_amount numeric not null default 0,
  net_amount numeric not null default 0,
  status payment_status not null default 'Pending',
  created_at timestamptz not null default now()
);

-- invoices
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete cascade,
  invoice_number text not null unique,
  created_at timestamptz not null default now()
);

-- reviews
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  type review_type not null,
  reviewer_user_id uuid not null references public.profiles(id) on delete cascade,
  target_id uuid not null,
  rating int not null check (rating between 1 and 5),
  comment text default '',
  related_reference_type reference_type not null,
  related_reference_id uuid not null,
  created_at timestamptz not null default now()
);

-- disputes
create table if not exists public.disputes (
  id uuid primary key default gen_random_uuid(),
  reference_type reference_type not null,
  reference_id uuid not null,
  opened_by_user_id uuid not null references public.profiles(id) on delete cascade,
  description text not null,
  status dispute_status not null default 'Open',
  outcome dispute_outcome,
  admin_notes text default '',
  created_at timestamptz not null default now()
);

-- messages
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  reference_type reference_type not null,
  reference_id uuid not null,
  sender_user_id uuid not null references public.profiles(id) on delete cascade,
  text text not null,
  created_at timestamptz not null default now()
);

-- notifications
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  body text default '',
  read boolean not null default false,
  kind notification_kind not null default 'system',
  created_at timestamptz not null default now()
);

-- =========================================================================
-- TRIGGER: create profile on new auth.user
-- =========================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role user_role;
  v_name text;
  v_company_id uuid;
  v_company_name text;
  v_company_city text;
  v_company_type company_type;
begin
  v_role := coalesce((new.raw_user_meta_data->>'role')::user_role, 'Customer'::user_role);
  v_name := coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1));
  v_company_name := new.raw_user_meta_data->>'company_name';
  v_company_city := coalesce(new.raw_user_meta_data->>'city', 'Vancouver');

  -- map role -> company_type
  v_company_type := case v_role
    when 'Customer' then 'Customer'::company_type
    when 'WarehouseProvider' then 'WarehouseProvider'::company_type
    when 'ServiceProvider' then 'ServiceProvider'::company_type
    when 'Employer' then 'Employer'::company_type
    when 'TruckingCompany' then 'TruckingCompany'::company_type
    when 'GateStaff' then 'WarehouseProvider'::company_type
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

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =========================================================================
-- RLS
-- =========================================================================
alter table public.profiles enable row level security;
alter table public.companies enable row level security;
alter table public.company_users enable row level security;
alter table public.platform_settings enable row level security;
alter table public.warehouse_listings enable row level security;
alter table public.warehouse_bookings enable row level security;
alter table public.service_listings enable row level security;
alter table public.service_jobs enable row level security;
alter table public.worker_profiles enable row level security;
alter table public.worker_certifications enable row level security;
alter table public.shift_posts enable row level security;
alter table public.shift_applications enable row level security;
alter table public.shift_assignments enable row level security;
alter table public.time_entries enable row level security;
alter table public.payments enable row level security;
alter table public.invoices enable row level security;
alter table public.reviews enable row level security;
alter table public.disputes enable row level security;
alter table public.messages enable row level security;
alter table public.notifications enable row level security;

-- helper: is admin
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('Admin','SuperAdmin')
  );
$$;

-- helper: current user's company_id
create or replace function public.my_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select company_id from public.profiles where id = auth.uid();
$$;

-- -------------------- profiles --------------------
drop policy if exists "profiles_self_read" on public.profiles;
create policy "profiles_self_read" on public.profiles
  for select using (auth.uid() = id or public.is_admin());

drop policy if exists "profiles_self_update" on public.profiles;
create policy "profiles_self_update" on public.profiles
  for update using (auth.uid() = id or public.is_admin());

drop policy if exists "profiles_self_insert" on public.profiles;
create policy "profiles_self_insert" on public.profiles
  for insert with check (auth.uid() = id or public.is_admin());

-- -------------------- companies --------------------
drop policy if exists "companies_read_all_auth" on public.companies;
create policy "companies_read_all_auth" on public.companies
  for select using (auth.role() = 'authenticated');

drop policy if exists "companies_owner_update" on public.companies;
create policy "companies_owner_update" on public.companies
  for update using (
    public.is_admin() or exists (
      select 1 from public.company_users cu
      where cu.company_id = companies.id and cu.user_id = auth.uid() and cu.company_role = 'Owner'
    )
  );

drop policy if exists "companies_admin_insert" on public.companies;
create policy "companies_admin_insert" on public.companies
  for insert with check (public.is_admin());

-- -------------------- company_users --------------------
drop policy if exists "company_users_self_read" on public.company_users;
create policy "company_users_self_read" on public.company_users
  for select using (user_id = auth.uid() or public.is_admin());

-- -------------------- platform_settings --------------------
drop policy if exists "settings_read" on public.platform_settings;
create policy "settings_read" on public.platform_settings
  for select using (auth.role() = 'authenticated');

drop policy if exists "settings_admin_write" on public.platform_settings;
create policy "settings_admin_write" on public.platform_settings
  for all using (public.is_admin()) with check (public.is_admin());

-- -------------------- warehouse_listings --------------------
drop policy if exists "wl_read_public_auth" on public.warehouse_listings;
create policy "wl_read_public_auth" on public.warehouse_listings
  for select using (auth.role() = 'authenticated');

drop policy if exists "wl_owner_write" on public.warehouse_listings;
create policy "wl_owner_write" on public.warehouse_listings
  for all using (
    public.is_admin() or company_id = public.my_company_id()
  ) with check (
    public.is_admin() or company_id = public.my_company_id()
  );

-- -------------------- warehouse_bookings --------------------
drop policy if exists "wb_read_parties" on public.warehouse_bookings;
create policy "wb_read_parties" on public.warehouse_bookings
  for select using (
    public.is_admin()
    or customer_company_id = public.my_company_id()
    or exists (
      select 1 from public.warehouse_listings wl
      where wl.id = warehouse_bookings.listing_id and wl.company_id = public.my_company_id()
    )
  );

drop policy if exists "wb_customer_insert" on public.warehouse_bookings;
create policy "wb_customer_insert" on public.warehouse_bookings
  for insert with check (
    public.is_admin() or customer_company_id = public.my_company_id()
  );

drop policy if exists "wb_parties_update" on public.warehouse_bookings;
create policy "wb_parties_update" on public.warehouse_bookings
  for update using (
    public.is_admin()
    or customer_company_id = public.my_company_id()
    or exists (
      select 1 from public.warehouse_listings wl
      where wl.id = warehouse_bookings.listing_id and wl.company_id = public.my_company_id()
    )
  );

-- -------------------- service_listings --------------------
drop policy if exists "sl_read_auth" on public.service_listings;
create policy "sl_read_auth" on public.service_listings
  for select using (auth.role() = 'authenticated');

drop policy if exists "sl_owner_write" on public.service_listings;
create policy "sl_owner_write" on public.service_listings
  for all using (public.is_admin() or company_id = public.my_company_id())
  with check (public.is_admin() or company_id = public.my_company_id());

-- -------------------- service_jobs --------------------
drop policy if exists "sj_read_parties" on public.service_jobs;
create policy "sj_read_parties" on public.service_jobs
  for select using (
    public.is_admin()
    or customer_company_id = public.my_company_id()
    or exists (
      select 1 from public.service_listings sl
      where sl.id = service_jobs.service_id and sl.company_id = public.my_company_id()
    )
  );

drop policy if exists "sj_customer_insert" on public.service_jobs;
create policy "sj_customer_insert" on public.service_jobs
  for insert with check (
    public.is_admin() or customer_company_id = public.my_company_id()
  );

drop policy if exists "sj_parties_update" on public.service_jobs;
create policy "sj_parties_update" on public.service_jobs
  for update using (
    public.is_admin()
    or customer_company_id = public.my_company_id()
    or exists (
      select 1 from public.service_listings sl
      where sl.id = service_jobs.service_id and sl.company_id = public.my_company_id()
    )
  );

-- -------------------- worker_profiles --------------------
drop policy if exists "wp_read_auth" on public.worker_profiles;
create policy "wp_read_auth" on public.worker_profiles
  for select using (auth.role() = 'authenticated');

drop policy if exists "wp_self_write" on public.worker_profiles;
create policy "wp_self_write" on public.worker_profiles
  for all using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

-- -------------------- worker_certifications --------------------
drop policy if exists "wc_self_read" on public.worker_certifications;
create policy "wc_self_read" on public.worker_certifications
  for select using (worker_user_id = auth.uid() or public.is_admin());

drop policy if exists "wc_self_write" on public.worker_certifications;
create policy "wc_self_write" on public.worker_certifications
  for all using (worker_user_id = auth.uid() or public.is_admin())
  with check (worker_user_id = auth.uid() or public.is_admin());

-- -------------------- shift_posts --------------------
drop policy if exists "sp_read_auth" on public.shift_posts;
create policy "sp_read_auth" on public.shift_posts
  for select using (auth.role() = 'authenticated');

drop policy if exists "sp_employer_write" on public.shift_posts;
create policy "sp_employer_write" on public.shift_posts
  for all using (public.is_admin() or employer_company_id = public.my_company_id())
  with check (public.is_admin() or employer_company_id = public.my_company_id());

-- -------------------- shift_applications --------------------
drop policy if exists "sa_read_parties" on public.shift_applications;
create policy "sa_read_parties" on public.shift_applications
  for select using (
    public.is_admin()
    or worker_user_id = auth.uid()
    or exists (
      select 1 from public.shift_posts sp
      where sp.id = shift_applications.shift_id and sp.employer_company_id = public.my_company_id()
    )
  );

drop policy if exists "sa_worker_insert" on public.shift_applications;
create policy "sa_worker_insert" on public.shift_applications
  for insert with check (worker_user_id = auth.uid());

drop policy if exists "sa_parties_update" on public.shift_applications;
create policy "sa_parties_update" on public.shift_applications
  for update using (
    public.is_admin()
    or worker_user_id = auth.uid()
    or exists (
      select 1 from public.shift_posts sp
      where sp.id = shift_applications.shift_id and sp.employer_company_id = public.my_company_id()
    )
  );

-- -------------------- shift_assignments --------------------
drop policy if exists "ass_read_parties" on public.shift_assignments;
create policy "ass_read_parties" on public.shift_assignments
  for select using (
    public.is_admin()
    or worker_user_id = auth.uid()
    or exists (
      select 1 from public.shift_posts sp
      where sp.id = shift_assignments.shift_id and sp.employer_company_id = public.my_company_id()
    )
  );

drop policy if exists "ass_employer_write" on public.shift_assignments;
create policy "ass_employer_write" on public.shift_assignments
  for all using (
    public.is_admin() or exists (
      select 1 from public.shift_posts sp
      where sp.id = shift_assignments.shift_id and sp.employer_company_id = public.my_company_id()
    )
  ) with check (
    public.is_admin() or exists (
      select 1 from public.shift_posts sp
      where sp.id = shift_assignments.shift_id and sp.employer_company_id = public.my_company_id()
    )
  );

-- -------------------- time_entries --------------------
drop policy if exists "te_read_parties" on public.time_entries;
create policy "te_read_parties" on public.time_entries
  for select using (
    public.is_admin()
    or exists (
      select 1 from public.shift_assignments a
      join public.shift_posts p on p.id = a.shift_id
      where a.id = time_entries.assignment_id
        and (a.worker_user_id = auth.uid() or p.employer_company_id = public.my_company_id())
    )
  );

drop policy if exists "te_parties_write" on public.time_entries;
create policy "te_parties_write" on public.time_entries
  for all using (
    public.is_admin()
    or exists (
      select 1 from public.shift_assignments a
      join public.shift_posts p on p.id = a.shift_id
      where a.id = time_entries.assignment_id
        and (a.worker_user_id = auth.uid() or p.employer_company_id = public.my_company_id())
    )
  ) with check (
    public.is_admin()
    or exists (
      select 1 from public.shift_assignments a
      join public.shift_posts p on p.id = a.shift_id
      where a.id = time_entries.assignment_id
        and (a.worker_user_id = auth.uid() or p.employer_company_id = public.my_company_id())
    )
  );

-- -------------------- payments --------------------
drop policy if exists "pay_read_auth" on public.payments;
create policy "pay_read_auth" on public.payments
  for select using (auth.role() = 'authenticated');

drop policy if exists "pay_admin_write" on public.payments;
create policy "pay_admin_write" on public.payments
  for all using (public.is_admin()) with check (public.is_admin());

-- -------------------- invoices --------------------
drop policy if exists "inv_read_auth" on public.invoices;
create policy "inv_read_auth" on public.invoices
  for select using (auth.role() = 'authenticated');

drop policy if exists "inv_admin_write" on public.invoices;
create policy "inv_admin_write" on public.invoices
  for all using (public.is_admin()) with check (public.is_admin());

-- -------------------- reviews --------------------
drop policy if exists "rv_read_auth" on public.reviews;
create policy "rv_read_auth" on public.reviews
  for select using (auth.role() = 'authenticated');

drop policy if exists "rv_self_write" on public.reviews;
create policy "rv_self_write" on public.reviews
  for insert with check (reviewer_user_id = auth.uid());

-- -------------------- disputes --------------------
drop policy if exists "dis_read_parties" on public.disputes;
create policy "dis_read_parties" on public.disputes
  for select using (public.is_admin() or opened_by_user_id = auth.uid());

drop policy if exists "dis_self_insert" on public.disputes;
create policy "dis_self_insert" on public.disputes
  for insert with check (opened_by_user_id = auth.uid());

drop policy if exists "dis_admin_update" on public.disputes;
create policy "dis_admin_update" on public.disputes
  for update using (public.is_admin());

-- -------------------- messages --------------------
drop policy if exists "msg_read_auth" on public.messages;
create policy "msg_read_auth" on public.messages
  for select using (auth.role() = 'authenticated');

drop policy if exists "msg_self_insert" on public.messages;
create policy "msg_self_insert" on public.messages
  for insert with check (sender_user_id = auth.uid());

-- -------------------- notifications --------------------
drop policy if exists "notif_self_read" on public.notifications;
create policy "notif_self_read" on public.notifications
  for select using (user_id = auth.uid() or public.is_admin());

drop policy if exists "notif_self_update" on public.notifications;
create policy "notif_self_update" on public.notifications
  for update using (user_id = auth.uid() or public.is_admin());

drop policy if exists "notif_admin_insert" on public.notifications;
create policy "notif_admin_insert" on public.notifications
  for insert with check (public.is_admin() or user_id = auth.uid());

-- =========================================================================
-- DEMO DATA (non-auth rows). Create demo auth users via Supabase dashboard:
--   admin@dock2door.ca / admin123   (role: Admin)
--   customer@freshmart.ca / password  (role: Customer)
--   provider@vandc.ca / password  (role: WarehouseProvider)
--   service@deltadev.ca / password  (role: ServiceProvider)
--   employer@deltalog.ca / password  (role: Employer)
--   worker.marcus@gmail.com / password  (role: Worker)
-- In Authentication > Users, add `raw_user_meta_data` like:
--   {"name":"James Chen","role":"Customer","company_name":"FreshMart Groceries","city":"Vancouver"}
-- The handle_new_user() trigger will create the matching profile + company row automatically.
-- =========================================================================

insert into public.platform_settings (warehouse_commission_percentage, service_commission_percentage, labour_commission_percentage, handling_fee_per_pallet_default, tax_mode)
select 8, 20, 15, 12, 'GST+PST'
where not exists (select 1 from public.platform_settings);
