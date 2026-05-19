-- ============================================================
-- 0037_schema_catchup.sql
-- ============================================================
-- WHY THIS EXISTS
-- ---------------
-- PostgreSQL's CREATE TABLE IF NOT EXISTS silently skips the
-- entire statement when the table already exists.  Any column
-- that was only defined inside a later CREATE TABLE IF NOT EXISTS
-- (instead of a separate ALTER TABLE … ADD COLUMN IF NOT EXISTS)
-- will simply never appear in the live DB.
--
-- This migration is a comprehensive, fully idempotent replay of
-- EVERY column that has been added to an existing table across
-- migrations 0001 – 0036.  It is safe to run against:
--   • A freshly migrated DB (no-ops for existing columns).
--   • A DB where earlier migrations ran with CREATE TABLE bugs.
--   • A DB that skipped individual migrations.
-- ============================================================

-- ============================================================
-- 1. shift_assignments
--    0001 base: id, shift_id, worker_user_id, confirmed_rate,
--               status, created_at
--    Added in 0008:  employer_company_id
--    Added in 0035:  worker_confirmed, worker_confirmed_at,
--                    cancellation_reason
-- ============================================================
alter table public.shift_assignments
  add column if not exists employer_company_id   uuid        references public.companies(id) on delete set null,
  add column if not exists worker_confirmed      boolean     default null,
  add column if not exists worker_confirmed_at   timestamptz,
  add column if not exists cancellation_reason   text;

-- Back-fill employer_company_id from shift_posts (safe no-op if already set)
update public.shift_assignments a
   set employer_company_id = p.employer_company_id
  from public.shift_posts p
 where p.id = a.shift_id
   and a.employer_company_id is null;

-- ============================================================
-- 2. time_entries
--    0001 base: id, assignment_id, start_timestamp,
--               end_timestamp, employer_confirmed_hours,
--               employer_notes
--    Added in 0024:  admin_approved_at, admin_approved_by,
--                    payroll_status
-- ============================================================
alter table public.time_entries
  add column if not exists admin_approved_at  timestamptz,
  add column if not exists admin_approved_by  uuid        references public.profiles(id) on delete set null,
  add column if not exists payroll_status     text        not null default 'pending';

-- Add the check constraint only if it doesn't exist yet
do $$ begin
  alter table public.time_entries
    add constraint time_entries_payroll_status_check
      check (payroll_status in ('pending','company_approved','admin_approved','invoice_ready','paid','disputed'));
exception when duplicate_object then null;
end $$;

-- ============================================================
-- 3. worker_profiles
--    0001 base: id, user_id, display_name, skills,
--               coverage_cities, hourly_expectation, verified,
--               status, bio, created_at
--    Added in 0023:  avatar_path, tagline, allow_public_photos
--    Added in 0024:  profile_photo_path, completed_shift_count,
--                    rating_average
--    Added in 0025:  phone, languages, experience_years,
--                    transportation, emergency_contact_name,
--                    emergency_contact_phone, references_text,
--                    work_history, education, preferred_shift,
--                    linkedin_url, website_url
-- ============================================================
alter table public.worker_profiles
  -- 0023
  add column if not exists avatar_path               text        default '',
  add column if not exists tagline                   text        default '',
  add column if not exists allow_public_photos       boolean     not null default false,
  -- 0024
  add column if not exists profile_photo_path        text        default '',
  add column if not exists completed_shift_count     integer     not null default 0,
  add column if not exists rating_average            numeric(3,2) not null default 0,
  -- 0025
  add column if not exists phone                     text        default '',
  add column if not exists languages                 text[]      not null default '{}',
  add column if not exists experience_years          integer     not null default 0,
  add column if not exists transportation            text        default '',
  add column if not exists emergency_contact_name    text        default '',
  add column if not exists emergency_contact_phone   text        default '',
  add column if not exists references_text           text        default '',
  add column if not exists work_history              text        default '',
  add column if not exists education                 text        default '',
  add column if not exists preferred_shift           text        default '',
  add column if not exists linkedin_url              text        default '',
  add column if not exists website_url               text        default '';

-- ============================================================
-- 4. service_jobs
--    0001 base: id, service_id, customer_company_id, …,
--               check_in_ts, check_out_ts, payment_status,
--               status, created_at
--    Added in 0008:  provider_company_id, created_by
-- ============================================================
alter table public.service_jobs
  add column if not exists provider_company_id  uuid  references public.companies(id) on delete set null,
  add column if not exists created_by           uuid  references auth.users(id)       on delete set null;

-- Back-fill provider_company_id from service_listings
update public.service_jobs j
   set provider_company_id = sl.company_id
  from public.service_listings sl
 where sl.id = j.service_id
   and j.provider_company_id is null;

-- ============================================================
-- 5. shift_posts
--    0001 base: id, employer_company_id, title, category, …
--    Added in 0008:  created_by
-- ============================================================
alter table public.shift_posts
  add column if not exists created_by  uuid  references auth.users(id) on delete set null;

-- ============================================================
-- 6. invoices
--    0001 base: id, reference_type, reference_id, …, status
--    Added in 0011:  customer_company_id, provider_company_id,
--                    booking_id, service_job_id, subtotal_amount,
--                    tax_amount, total_amount, currency, due_date,
--                    issued_at, paid_at, voided_at, invoice_number,
--                    pdf_path
--    Added in 0015:  stripe_checkout_session_id,
--                    stripe_payment_intent_id
-- ============================================================
alter table public.invoices
  -- 0011
  add column if not exists customer_company_id        uuid      references public.companies(id)          on delete set null,
  add column if not exists provider_company_id        uuid      references public.companies(id)          on delete set null,
  add column if not exists booking_id                 uuid      references public.warehouse_bookings(id)  on delete set null,
  add column if not exists service_job_id             uuid      references public.service_jobs(id)        on delete set null,
  add column if not exists subtotal_amount            numeric   not null default 0,
  add column if not exists tax_amount                 numeric   not null default 0,
  add column if not exists total_amount               numeric   not null default 0,
  add column if not exists currency                   text      not null default 'CAD',
  add column if not exists due_date                   date,
  add column if not exists issued_at                  timestamptz,
  add column if not exists paid_at                    timestamptz,
  add column if not exists voided_at                  timestamptz,
  add column if not exists invoice_number             text,
  add column if not exists pdf_path                   text,
  -- 0015
  add column if not exists stripe_checkout_session_id text,
  add column if not exists stripe_payment_intent_id   text;

-- ============================================================
-- 7. payments
--    0001 base: id, reference_type, reference_id, gross_amount,
--               commission_amount, net_amount, status, created_at
--    Added in 0011:  invoice_id, customer_company_id,
--                    provider_company_id, stripe_payment_intent_id,
--                    stripe_charge_id, payment_method,
--                    authorized_at, captured_at, refunded_at
-- ============================================================
alter table public.payments
  add column if not exists invoice_id               uuid   references public.invoices(id)   on delete set null,
  add column if not exists customer_company_id      uuid   references public.companies(id)  on delete set null,
  add column if not exists provider_company_id      uuid   references public.companies(id)  on delete set null,
  add column if not exists stripe_payment_intent_id text,
  add column if not exists stripe_charge_id         text,
  add column if not exists payment_method           text,
  add column if not exists authorized_at            timestamptz,
  add column if not exists captured_at              timestamptz,
  add column if not exists refunded_at              timestamptz;

-- Unique index on stripe_payment_intent_id (idempotent)
create unique index if not exists payments_stripe_pi_unique
  on public.payments(stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

-- ============================================================
-- 8. disputes
--    0001 base: id, reference_type, reference_id, raised_by,
--               reason, status, created_at
--    Added in 0011:  payment_id, resolution_amount, resolved_by,
--                    resolved_at
--    refund_id references refunds which may not exist — guard it.
-- ============================================================
alter table public.disputes
  add column if not exists payment_id         uuid      references public.payments(id)   on delete set null,
  add column if not exists resolution_amount  numeric   default 0,
  add column if not exists resolved_by        uuid      references public.profiles(id)   on delete set null,
  add column if not exists resolved_at        timestamptz;

-- refund_id: only add FK if refunds table exists
do $$ begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'refunds') then
    execute $sql$
      alter table public.disputes
        add column if not exists refund_id uuid
          references public.refunds(id) on delete set null
    $sql$;
  end if;
end $$;

-- ============================================================
-- 9. notifications
--    0001 base: id, user_id, title, body, read, kind,
--               created_at
--    Added in 0014:  company_id, entity_type, entity_id,
--                    read_at, payload
--    (user_id / title / body / kind already existed in 0001,
--     so those ADD COLUMN IF NOT EXISTS are safe no-ops)
-- ============================================================
alter table public.notifications
  add column if not exists company_id   uuid     references public.companies(id)  on delete cascade,
  add column if not exists entity_type  text,
  add column if not exists entity_id    text,
  add column if not exists read_at      timestamptz,
  add column if not exists payload      jsonb    not null default '{}'::jsonb;

-- ============================================================
-- 10. companies
--     0001 base: id, type, owner_user_id, name, status,
--                created_at, …
--     Added in 0015:  stripe_connect_account_id,
--                     stripe_connect_onboarded
-- ============================================================
alter table public.companies
  add column if not exists stripe_connect_account_id  text,
  add column if not exists stripe_connect_onboarded   boolean  not null default false;

-- ============================================================
-- 11. reviews
--     0001 base: id, reviewer_user_id, rating, comment,
--                created_at  (old schema)
--     Fixed in 0029 — but replay here for databases where 0029
--     was skipped or failed partially.
-- ============================================================
do $$ begin
  create type review_target_kind as enum ('company', 'worker');
exception when duplicate_object then null; end $$;

do $$ begin
  create type review_context_kind as enum
    ('warehouse_booking', 'service_job', 'shift_assignment');
exception when duplicate_object then null; end $$;

alter table public.reviews
  add column if not exists reviewer_company_id  uuid  references public.companies(id)  on delete set null,
  add column if not exists target_kind          review_target_kind,
  add column if not exists target_company_id    uuid  references public.companies(id)  on delete cascade,
  add column if not exists target_user_id       uuid  references public.profiles(id)   on delete cascade,
  add column if not exists context_kind         review_context_kind,
  add column if not exists context_id           uuid;

-- Indexes (idempotent)
create index if not exists idx_reviews_target_company
  on public.reviews(target_company_id)
  where target_company_id is not null;

create index if not exists idx_reviews_target_user
  on public.reviews(target_user_id)
  where target_user_id is not null;

create index if not exists idx_reviews_context
  on public.reviews(context_kind, context_id)
  where context_kind is not null;

create index if not exists idx_reviews_reviewer
  on public.reviews(reviewer_user_id);

-- ============================================================
-- 12. work_photos
--     0023 base: id, worker_user_id, shift_assignment_id,
--                file_path, caption, visibility, approved_by,
--                approved_at, created_at
--     Added in 0024:  moderation_status, rejection_reason
-- ============================================================
do $$ begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'work_photos') then
    execute $sql$
      alter table public.work_photos
        add column if not exists moderation_status text not null default 'pending',
        add column if not exists rejection_reason  text          default ''
    $sql$;
  end if;
end $$;

-- Ensure check constraint on moderation_status
do $$ begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'work_photos') then
    execute $sql$
      alter table public.work_photos
        add constraint work_photos_moderation_status_check
          check (moderation_status in ('pending','approved','rejected'))
    $sql$;
  end if;
exception when duplicate_object then null;
end $$;

-- ============================================================
-- 13. worker_private_info
--     0027 base: id, user_id, sin_encrypted, dob, …
--     Added in 0031:  address_line1, address_line2, city,
--                     province, postal_code, country,
--                     nationality, govt_id_path, govt_id_type
-- ============================================================
do $$ begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'worker_private_info') then
    execute $sql$
      alter table public.worker_private_info
        add column if not exists address_line1  text default '',
        add column if not exists address_line2  text default '',
        add column if not exists city           text default '',
        add column if not exists province       text default '',
        add column if not exists postal_code    text default '',
        add column if not exists country        text default 'Canada',
        add column if not exists nationality    text default '',
        add column if not exists govt_id_path   text default '',
        add column if not exists govt_id_type   text default ''
    $sql$;
  end if;
end $$;

-- ============================================================
-- 14. worker_profiles — ensure allow_public_photos NOT NULL
--     Some databases may have the column as nullable if 0023 ran
--     but without the NOT NULL clause.  Set a safe default first.
-- ============================================================
do $$ begin
  update public.worker_profiles
     set allow_public_photos = false
   where allow_public_photos is null;
exception when others then null; end $$;

-- ============================================================
-- 15. notification_kind enum — values added in 0029
--     (idempotent ADD VALUE IF NOT EXISTS)
-- ============================================================
do $$ begin
  alter type public.notification_kind add value if not exists 'info';
exception when others then null; end $$;

do $$ begin
  alter type public.notification_kind add value if not exists 'thread_message';
exception when others then null; end $$;

do $$ begin
  alter type public.notification_kind add value if not exists 'booking_status';
exception when others then null; end $$;

do $$ begin
  alter type public.notification_kind add value if not exists 'worker_assigned';
exception when others then null; end $$;

do $$ begin
  alter type public.notification_kind add value if not exists 'shift_changed';
exception when others then null; end $$;

do $$ begin
  alter type public.notification_kind add value if not exists 'shift_cancelled';
exception when others then null; end $$;

do $$ begin
  alter type public.notification_kind add value if not exists 'payment';
exception when others then null; end $$;

do $$ begin
  alter type public.notification_kind add value if not exists 'review';
exception when others then null; end $$;

-- ============================================================
-- 16. payment_status / dispute_status — values added in 0029
-- ============================================================
do $$ begin
  alter type public.payment_status add value if not exists 'Authorized';
exception when others then null; end $$;

do $$ begin
  alter type public.payment_status add value if not exists 'Captured';
exception when others then null; end $$;

do $$ begin
  alter type public.payment_status add value if not exists 'Failed';
exception when others then null; end $$;

do $$ begin
  alter type public.payment_status add value if not exists 'PartiallyRefunded';
exception when others then null; end $$;

do $$ begin
  alter type public.dispute_status add value if not exists 'Rejected';
exception when others then null; end $$;

do $$ begin
  alter type public.dispute_status add value if not exists 'Escalated';
exception when others then null; end $$;

-- ============================================================
-- END 0037_schema_catchup.sql
-- ============================================================
