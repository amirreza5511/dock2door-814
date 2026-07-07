-- Dock2Door — Advertisements.
-- A platform-wide ad system: the super admin curates sponsored placements
-- (from warehouses, trucking/haulage companies, realtors, service providers,
-- etc.) that render in a compact banner docked under every page of the app.
-- Users can see the ad and tap it to open the advertiser's web page.
-- Impressions and clicks are counted for basic performance reporting.
-- Idempotent.

create table if not exists public.advertisements (
  id uuid primary key default gen_random_uuid(),
  -- Creative
  title text not null,
  body text not null default '',
  image_url text not null default '',
  target_url text not null default '',
  cta_label text not null default 'Learn more',
  -- Who is advertising
  advertiser_name text not null default '',
  advertiser_company_id uuid references public.companies(id) on delete set null,
  -- Where to show it. 'all' = every page; otherwise a role/segment key such as
  -- 'warehouse-provider', 'trucking-company', 'customer', 'driver', etc.
  placement text not null default 'all',
  -- Active | Paused
  status text not null default 'Active',
  -- Higher priority ads win the rotation slot first.
  priority int not null default 0,
  -- Optional flight window; NULL means unbounded on that side.
  starts_at timestamptz,
  ends_at timestamptz,
  -- Performance counters
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_advertisements_serving
  on public.advertisements(status, placement, priority desc);

alter table public.advertisements enable row level security;

-- Any authenticated user can read ads (the banner filters to Active + in-window
-- client-side / in the serve query). Only admins can create/update/delete.
drop policy if exists "advertisements_read" on public.advertisements;
create policy "advertisements_read" on public.advertisements
  for select using (public.is_authenticated());

drop policy if exists "advertisements_manage" on public.advertisements;
create policy "advertisements_manage" on public.advertisements
  for all using (public.is_admin()) with check (public.is_admin());

-- =========================================================================
-- Impression / click counters — SECURITY DEFINER so any authenticated viewer
-- can bump the counters without holding UPDATE rights on the table.
-- =========================================================================
create or replace function public.ad_record_impression(p_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.advertisements set impressions = impressions + 1 where id = p_id;
$$;
grant execute on function public.ad_record_impression(uuid) to authenticated;

create or replace function public.ad_record_click(p_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.advertisements set clicks = clicks + 1 where id = p_id;
$$;
grant execute on function public.ad_record_click(uuid) to authenticated;

notify pgrst, 'reload schema';
