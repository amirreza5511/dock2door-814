-- Dock2Door — add the missing `currency` column to payments.
-- The finance layer (record_payment, accept_load, etc.) has always INSERTed a
-- `currency` value into public.payments, but no migration ever actually added
-- the column. On databases provisioned from 0001_init this makes accept_load
-- fail with: column "currency" of relation "payments" does not exist.
-- Idempotent.

alter table public.payments add column if not exists currency text not null default 'CAD';

-- Payouts is created in 0082 with a currency column already, but guard anyway
-- in case an older payouts table exists without it.
alter table public.payouts  add column if not exists currency text not null default 'CAD';
