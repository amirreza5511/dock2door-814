-- 0029_schema_fixes.sql
-- Idempotent. Fixes four confirmed schema bugs introduced by earlier migrations.
--
-- BUG 1: reviews table
--   0001 created reviews with the old schema (type, target_id, related_reference_type…).
--   0010 used CREATE TABLE IF NOT EXISTS — a no-op since the table already existed —
--   so the new columns expected by post_review() were never added. Fixed below.
--
-- BUG 2: tg_notify_thread_message trigger (0016)
--   References profiles.full_name which does not exist. Column is profiles.name. Fixed below.
--
-- BUG 3: notifications.kind column type
--   0001 created notifications.kind as notification_kind enum ('booking','service','shift','system','dispute').
--   0014 tried ALTER TABLE ... ADD COLUMN IF NOT EXISTS kind text — but the column already
--   existed so it was a no-op. Result: all queue_notification() calls with kind values like
--   'thread_message','booking_status','worker_assigned','info','shift_changed','shift_cancelled'
--   etc. fail because those values are not in the enum.
--   Fix: add the missing values via direct pg_enum insert (immediately visible in same txn),
--   then set the column default. Using pg_enum INSERT avoids the 55P04 error that occurs
--   when ALTER TYPE … ADD VALUE and a subsequent use of that value are in the same transaction.
--
-- BUG 4: payment_status / dispute_status enum values
--   0001 created payment_status as ('Pending','Paid','Refunded').
--   0011 tried to CREATE TYPE payment_status … with additional values — duplicate_object
--   exception swallowed, so 'Authorized','Captured','Failed','PartiallyRefunded' never
--   existed. record_payment() sets status='Captured' → runtime error.
--   Same pattern for dispute_status: 0011 values 'Rejected','Escalated' never added.

-- =========================================================================
-- 1) reviews table — add columns expected by post_review RPC and UI code
-- =========================================================================
do $$ begin
  create type review_target_kind as enum ('company', 'worker');
exception when duplicate_object then null; end $$;

do $$ begin
  create type review_context_kind as enum (
    'warehouse_booking',
    'service_job',
    'shift_assignment'
  );
exception when duplicate_object then null; end $$;

-- Add the new-schema columns (idempotent)
alter table public.reviews
  add column if not exists reviewer_company_id  uuid references public.companies(id)  on delete set null,
  add column if not exists target_kind          review_target_kind,
  add column if not exists target_company_id    uuid references public.companies(id)  on delete cascade,
  add column if not exists target_user_id       uuid references public.profiles(id)   on delete cascade,
  add column if not exists context_kind         review_context_kind,
  add column if not exists context_id           uuid;

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

do $$ begin
  alter table public.reviews
    add constraint reviews_unique_per_context
      unique (reviewer_user_id, context_kind, context_id, target_kind);
exception
  when duplicate_object then null;
  when others           then null;
end $$;

alter table public.reviews enable row level security;
drop policy if exists "reviews_read_all"         on public.reviews;
drop policy if exists "rv_read_auth"             on public.reviews;
drop policy if exists "rv_self_write"            on public.reviews;
drop policy if exists "reviews_no_direct_insert" on public.reviews;
drop policy if exists "reviews_no_direct_update" on public.reviews;
drop policy if exists "reviews_no_direct_delete" on public.reviews;

create policy "reviews_read_all" on public.reviews
  for select using (auth.uid() is not null);
-- No direct insert/update/delete — all writes go through post_review() RPC.

-- =========================================================================
-- 2) Fix tg_notify_thread_message: profiles.full_name → profiles.name
-- =========================================================================
create or replace function public.tg_notify_thread_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender_name text;
  v_thread      public.chat_threads;
  v_preview     text;
  r             record;
begin
  select * into v_thread from public.chat_threads where id = new.thread_id;
  if v_thread is null then
    return new;
  end if;

  -- FIX: use profiles.name (profiles.full_name does not exist)
  select coalesce(nullif(trim(name), ''), 'New message')
    into v_sender_name
    from public.profiles
   where id = new.sender_user_id;
  v_sender_name := coalesce(v_sender_name, 'New message');

  v_preview := coalesce(new.body, '');
  if length(v_preview) > 140 then
    v_preview := substr(v_preview, 1, 137) || '...';
  end if;
  if v_preview = '' and jsonb_array_length(coalesce(new.attachments, '[]'::jsonb)) > 0 then
    v_preview := '[attachment]';
  end if;

  for r in
    select tp.user_id
      from public.thread_participants tp
     where tp.thread_id = new.thread_id
       and tp.user_id is distinct from new.sender_user_id
  loop
    if coalesce(
         (select np.push_enabled
            from public.notification_preferences np
           where np.user_id = r.user_id),
         true
       ) then
      perform public.queue_notification(
        r.user_id,
        'thread_message',
        v_sender_name,
        v_preview,
        'chat_threads',
        new.thread_id::text,
        jsonb_build_object(
          'thread_id',      new.thread_id,
          'message_id',     new.id,
          'sender_user_id', new.sender_user_id,
          'sender_name',    v_sender_name,
          'scope',          v_thread.scope
        )
      );
    end if;
  end loop;

  update public.chat_threads set updated_at = now() where id = new.thread_id;
  return new;
end;
$$;

drop trigger if exists tr_notify_thread_message on public.thread_messages;
create trigger tr_notify_thread_message
  after insert on public.thread_messages
  for each row execute function public.tg_notify_thread_message();

-- =========================================================================
-- 3) notifications.kind — add missing enum values
--    0001 created notification_kind as (booking, service, shift, system, dispute).
--    All queue_notification() calls from later migrations use values outside that set.
--
--    FIX: Use direct pg_enum INSERT instead of ALTER TYPE … ADD VALUE so the new
--    labels are immediately visible within this transaction (avoids error 55P04:
--    "unsafe use of new value … New enum values must be committed before they can be used").
-- =========================================================================
do $$
declare
  v_oid    oid;
  v_label  text;
  v_labels text[] := array[
    'info','thread_message','booking_status','worker_assigned',
    'shift_changed','shift_cancelled','payment','review'
  ];
begin
  select t.oid into v_oid
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
   where t.typname = 'notification_kind' and n.nspname = 'public';

  if v_oid is null then return; end if;

  foreach v_label in array v_labels loop
    if not exists (
      select 1 from pg_enum where enumtypid = v_oid and enumlabel = v_label
    ) then
      insert into pg_enum (enumtypid, enumlabel, enumsortorder)
      values (
        v_oid,
        v_label,
        (select coalesce(max(enumsortorder), 0) + 1 from pg_enum where enumtypid = v_oid)
      );
    end if;
  end loop;
end $$;

-- Now 'info' is committed and visible — safe to set as column default.
alter table public.notifications
  alter column kind set default 'info';

-- Also ensure the kind text column the UI code writes is compatible.
-- queue_notification(p_kind text) does: coalesce(p_kind,'info') then inserts into kind.
-- Since kind is still notification_kind (enum), the cast must succeed.
-- Re-create queue_notification to cast the text arg explicitly:
create or replace function public.queue_notification(
  p_user_id    uuid,
  p_kind       text,
  p_title      text,
  p_body       text,
  p_entity_type text,
  p_entity_id   text,
  p_payload     jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_kind notification_kind;
begin
  -- Try to cast; fall back to 'system' if the value isn't in the enum yet.
  begin
    v_kind := coalesce(p_kind, 'info')::notification_kind;
  exception when invalid_text_representation then
    v_kind := 'system'::notification_kind;
  end;

  insert into public.notifications (user_id, kind, title, body, entity_type, entity_id, payload)
    values (
      p_user_id,
      v_kind,
      coalesce(p_title, ''),
      coalesce(p_body, ''),
      p_entity_type,
      p_entity_id,
      coalesce(p_payload, '{}'::jsonb)
    )
  returning id into v_id;
  return v_id;
end;
$$;
-- queue_notification is intentionally not granted to authenticated (service-role only).
-- Already revoked in 0014 but be explicit:
revoke execute on function public.queue_notification(uuid,text,text,text,text,text,jsonb) from public, authenticated;

-- =========================================================================
-- 4a) payment_status enum — add missing values
--     0001 created: Pending, Paid, Refunded
--     0011 tried to recreate (duplicate_object swallowed) — missing: Authorized, Captured, Failed, PartiallyRefunded
--     FIX: direct pg_enum insert (visible immediately in same transaction)
-- =========================================================================
do $$
declare
  v_oid    oid;
  v_label  text;
  v_labels text[] := array['Authorized','Captured','Failed','PartiallyRefunded'];
begin
  select t.oid into v_oid
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
   where t.typname = 'payment_status' and n.nspname = 'public';

  if v_oid is null then return; end if;

  foreach v_label in array v_labels loop
    if not exists (
      select 1 from pg_enum where enumtypid = v_oid and enumlabel = v_label
    ) then
      insert into pg_enum (enumtypid, enumlabel, enumsortorder)
      values (
        v_oid,
        v_label,
        (select coalesce(max(enumsortorder), 0) + 1 from pg_enum where enumtypid = v_oid)
      );
    end if;
  end loop;
end $$;

-- =========================================================================
-- 4b) dispute_status enum — add missing values
--     0001 created: Open, UnderReview, Resolved
--     0011 tried to recreate — missing: Rejected, Escalated
--     FIX: direct pg_enum insert
-- =========================================================================
do $$
declare
  v_oid    oid;
  v_label  text;
  v_labels text[] := array['Rejected','Escalated'];
begin
  select t.oid into v_oid
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
   where t.typname = 'dispute_status' and n.nspname = 'public';

  if v_oid is null then return; end if;

  foreach v_label in array v_labels loop
    if not exists (
      select 1 from pg_enum where enumtypid = v_oid and enumlabel = v_label
    ) then
      insert into pg_enum (enumtypid, enumlabel, enumsortorder)
      values (
        v_oid,
        v_label,
        (select coalesce(max(enumsortorder), 0) + 1 from pg_enum where enumtypid = v_oid)
      );
    end if;
  end loop;
end $$;
