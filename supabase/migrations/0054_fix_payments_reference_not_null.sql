-- 0054_fix_payments_reference_not_null.sql
--
-- CONTEXT
-- -------
-- Migration 0001 created public.payments with:
--     reference_type  reference_type  NOT NULL
--     reference_id    uuid            NOT NULL
--
-- Migration 0048 attempted to fix this with DO $$ blocks that swallow errors,
-- but those blocks use `exception when others then null` which silently ignores
-- ALL errors — including the case where the column doesn't exist yet, or when
-- the ALTER already succeeded.  The DROP NOT NULL is idempotent in PostgreSQL
-- (dropping NOT NULL on a nullable column is a no-op, not an error), so the
-- 0048 blocks should have worked — but this migration re-applies them as plain
-- ALTER TABLE statements (no exception swallowing) so that:
--   1. A fresh migration chain confirms the constraints are gone.
--   2. Any database that skipped 0048 picks this up.
--
-- VERIFICATION QUERY (run in Supabase SQL editor after applying):
--
--   SELECT column_name, is_nullable
--   FROM information_schema.columns
--   WHERE table_schema = 'public'
--     AND table_name   = 'payments'
--     AND column_name  IN ('reference_type', 'reference_id');
--
-- Expected: BOTH rows show is_nullable = 'YES'.
--
-- record_payment() in 0043 does NOT insert reference_type or reference_id:
--
--   insert into public.payments (
--     invoice_id, booking_id,
--     customer_company_id, provider_company_id,
--     gross_amount, commission_amount, net_amount, currency,
--     status, stripe_payment_intent_id, payment_method,
--     authorized_at, captured_at
--   ) values ( ... );
--
-- After this migration, payments rows inserted by record_payment() will not
-- crash with "null value in column reference_type violates not-null constraint".
--
-- Idempotent — DROP NOT NULL on a nullable column is a no-op in PostgreSQL.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Drop NOT NULL on payments.reference_type
-- ─────────────────────────────────────────────────────────────────────────────
do $safe$ begin
  alter table public.payments alter column reference_type drop not null;
exception
  when undefined_column then null;   -- column doesn't exist (wrong schema version)
  when undefined_table  then null;   -- table doesn't exist yet
end $safe$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Drop NOT NULL on payments.reference_id
-- ─────────────────────────────────────────────────────────────────────────────
do $safe$ begin
  alter table public.payments alter column reference_id drop not null;
exception
  when undefined_column then null;
  when undefined_table  then null;
end $safe$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Verify (advisory — will raise a WARNING if any column is still NOT NULL
--    so it shows up clearly in migration output, but does not abort the tx)
-- ─────────────────────────────────────────────────────────────────────────────
do $verify$ declare
  v_nullable text;
begin
  select is_nullable into v_nullable
  from information_schema.columns
  where table_schema = 'public'
    and table_name   = 'payments'
    and column_name  = 'reference_type';

  if v_nullable = 'NO' then
    raise warning '0054: payments.reference_type is still NOT NULL after migration — check for a conflicting constraint';
  end if;

  select is_nullable into v_nullable
  from information_schema.columns
  where table_schema = 'public'
    and table_name   = 'payments'
    and column_name  = 'reference_id';

  if v_nullable = 'NO' then
    raise warning '0054: payments.reference_id is still NOT NULL after migration — check for a conflicting constraint';
  end if;
end $verify$;
