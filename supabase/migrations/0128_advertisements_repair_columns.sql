-- =========================================================================
-- 0128 — Advertisements: repair / guarantee all columns exist.
-- Fully idempotent, additive, and self-contained. Safe to run any number of
-- times and in any order relative to 0119–0127.
--
-- Why this exists: on some databases the self-serve columns from 0123
-- (source, review_status, price, currency, admin_note, …) and the usage-
-- billing columns from 0127 were never applied, so the Ad Manager query
-- fails with "column advertisements.source does not exist". This migration
-- ensures every column the app reads is present, regardless of which earlier
-- migrations ran, so the super-admin Ad Manager loads cleanly.
-- =========================================================================

alter table public.advertisements
  -- self-serve lifecycle (from 0123)
  add column if not exists submitted_by uuid references public.profiles(id) on delete set null,
  add column if not exists owner_company_id uuid references public.companies(id) on delete set null,
  add column if not exists source text not null default 'admin',
  add column if not exists review_status text,
  add column if not exists price numeric not null default 0,
  add column if not exists currency text not null default 'CAD',
  add column if not exists paid_at timestamptz,
  add column if not exists admin_note text not null default '',
  -- performance counters (from 0119, re-asserted for safety)
  add column if not exists impressions bigint not null default 0,
  add column if not exists clicks bigint not null default 0,
  -- usage billing (from 0127)
  add column if not exists pricing_model text not null default 'flat',
  add column if not exists cpm_rate numeric not null default 0,
  add column if not exists cpc_rate numeric not null default 0,
  add column if not exists budget_cap numeric not null default 0,
  add column if not exists billed_impressions bigint not null default 0,
  add column if not exists billed_clicks bigint not null default 0,
  add column if not exists billed_amount numeric not null default 0;

create index if not exists idx_advertisements_review
  on public.advertisements(source, review_status, created_at desc);
create index if not exists idx_advertisements_submitter
  on public.advertisements(submitted_by, created_at desc);

notify pgrst, 'reload schema';
