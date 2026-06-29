-- =========================================================================
-- 0090 — Fix legacy NOT NULL columns on public.reviews
--
-- BUG: 0001 created public.reviews with an OLD schema whose columns are
--   NOT NULL:
--     type                  review_type   not null
--     target_id             uuid          not null
--     related_reference_type reference_type not null
--     related_reference_id  uuid          not null
--   0010/0029/0037 added the NEW-schema columns (target_kind, target_company_id,
--   target_user_id, context_kind, context_id, reviewer_company_id) but never
--   relaxed the old ones. post_review() inserts only the new columns, so on any
--   database that still has the original table, the insert fails with:
--     null value in column "type" of relation "reviews" violates not-null constraint
--
-- FIX (idempotent): drop the NOT NULL constraints on the legacy columns so the
--   new-schema insert succeeds. We keep the columns (some old rows may use them)
--   but make them optional. Safe to run repeatedly.
-- =========================================================================

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'reviews' and column_name = 'type'
  ) then
    execute 'alter table public.reviews alter column type drop not null';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'reviews' and column_name = 'target_id'
  ) then
    execute 'alter table public.reviews alter column target_id drop not null';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'reviews' and column_name = 'related_reference_type'
  ) then
    execute 'alter table public.reviews alter column related_reference_type drop not null';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'reviews' and column_name = 'related_reference_id'
  ) then
    execute 'alter table public.reviews alter column related_reference_id drop not null';
  end if;
end $$;
