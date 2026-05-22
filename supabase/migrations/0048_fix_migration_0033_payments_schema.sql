-- 0048_fix_migration_0033_payments_schema.sql
--
-- BUG 1 — Migration 0033 used '$' (single dollar sign) as the CREATE OR REPLACE
--   FUNCTION dollar-quote delimiter instead of '$$'. PostgreSQL dollar-quoting
--   requires a minimum of two dollar signs (the $$...$$ empty-tag form).
--   A single '$' is NOT a valid dollar-quote opener:
--     - PostgreSQL reads 'as $', then scans for a matching closing '$' with the
--       same tag. The tag would be everything between the two '$' characters —
--       but that content contains whitespace and control characters, violating
--       identifier rules, so the entire CREATE OR REPLACE FUNCTION statement
--       raises a syntax error at parse time.
--     - Result: sync_admin_role_from_profile() was NEVER successfully created;
--       the trg_sync_admin_role trigger exists but fires a missing/broken
--       function, so new Admin/SuperAdmin profiles are never backfilled into
--       user_roles — is_admin() returns false for any admin created after 0003.
--   FIX: recreate with correct $$ delimiters. Idempotent via CREATE OR REPLACE.
--
-- BUG 2 — Migration 0001 created public.payments with two NOT NULL columns:
--     reference_type  reference_type  NOT NULL
--     reference_id    uuid            NOT NULL
--   Migrations 0011 and 0037 added new columns via ADD COLUMN IF NOT EXISTS but
--   never touched the NOT NULL constraints on these two legacy columns.
--   The record_payment() RPC (0043) inserts a new payments row without providing
--   values for reference_type / reference_id → every payment record attempt
--   fails with:
--     ERROR: null value in column "reference_type" violates not-null constraint
--   FIX: drop NOT NULL from both legacy columns (they are kept for backwards
--   compat; new inserts simply leave them NULL).
--
-- Idempotent — safe to apply to any DB state.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Recreate sync_admin_role_from_profile() with correct $$ delimiters
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.sync_admin_role_from_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Gained admin / superadmin status (handles INSERT where role is already set,
  -- and UPDATE that promotes the user)
  if NEW.role in ('Admin', 'SuperAdmin') then
    insert into public.user_roles (user_id, role)
    values (NEW.id, 'admin')
    on conflict (user_id, role) do nothing;

  -- Lost admin / superadmin status (UPDATE only — on INSERT OLD is NULL)
  elsif TG_OP = 'UPDATE'
    and OLD.role in ('Admin', 'SuperAdmin')
    and NEW.role not in ('Admin', 'SuperAdmin')
  then
    delete from public.user_roles
    where user_id = NEW.id and role = 'admin';
  end if;

  return NEW;
end;
$$;

-- Re-create the trigger so it picks up the corrected function body.
drop trigger if exists trg_sync_admin_role on public.profiles;
create trigger trg_sync_admin_role
  after insert or update of role on public.profiles
  for each row
  execute function public.sync_admin_role_from_profile();

-- Re-run the backfill: any Admin/SuperAdmin created while the function was
-- broken will have been missed.  ON CONFLICT DO NOTHING makes this a no-op
-- for users already correctly synced.
insert into public.user_roles (user_id, role)
select p.id, 'admin'
from   public.profiles p
where  p.role in ('Admin', 'SuperAdmin')
  and  not exists (
    select 1 from public.user_roles ur
    where  ur.user_id = p.id and ur.role = 'admin'
  )
on conflict (user_id, role) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Drop NOT NULL on payments.reference_type and payments.reference_id
-- ─────────────────────────────────────────────────────────────────────────────
do $$ begin
  alter table public.payments alter column reference_type drop not null;
exception when others then null;
end $$;

do $$ begin
  alter table public.payments alter column reference_id drop not null;
exception when others then null;
end $$;

-- Also ensure invoices.status column exists and has a sensible default
-- (0001 created invoices without a status column; 0011 only ADDs it if missing)
do $$ begin
  alter table public.invoices add column if not exists status text not null default 'Draft';
exception when others then null;
end $$;
