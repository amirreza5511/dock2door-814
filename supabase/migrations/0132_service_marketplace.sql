-- Dock2Door — Services Marketplace (equipment rental, mobile repair, general services)
-- ------------------------------------------------------------------------------
-- Extends `service_listings` so ANY company can publish a marketplace listing in
-- one of three types — general service, equipment rental, or mobile repair — and
-- ANY authenticated business user can browse and request them. Reuses the
-- existing `service_jobs` table for requests/bookings.
--
-- Additive & idempotent. Safe to re-run. No RLS changes are needed:
--   * sl_read_auth   — any authenticated user can read listings  (browse works)
--   * sl_owner_write — any company can write its own listings     (listing works)
--   * sj_customer_insert — any company can request a service_job  (requests work)

-- =============================================================
-- 1) New columns on service_listings
-- =============================================================
alter table public.service_listings
  add column if not exists service_type text    not null default 'service',
  add column if not exists title        text    not null default '',
  add column if not exists description  text    not null default '',
  add column if not exists subcategory  text    not null default '',
  add column if not exists daily_rate   numeric,
  add column if not exists weekly_rate  numeric,
  add column if not exists negotiable   boolean not null default false;

-- Equipment-rental / mobile-repair listings don't map onto the legacy
-- `category` enum, so give it a default that satisfies NOT NULL when the
-- marketplace insert path omits it. Legacy service-provider inserts still pass
-- their own category explicitly.
alter table public.service_listings alter column category set default 'Labour';

-- Backfill service_type for any pre-existing rows.
update public.service_listings
   set service_type = 'service'
 where service_type is null or service_type = '';

-- Constrain service_type to the supported set.
alter table public.service_listings drop constraint if exists service_listings_service_type_chk;
alter table public.service_listings
  add constraint service_listings_service_type_chk
  check (service_type in ('service', 'equipment_rental', 'mobile_repair'));

-- Fast browse by status + type.
create index if not exists idx_service_listings_browse
  on public.service_listings(status, service_type);
