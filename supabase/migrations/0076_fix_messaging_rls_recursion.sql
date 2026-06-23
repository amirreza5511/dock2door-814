-- 0076_fix_messaging_rls_recursion.sql
-- Fixes the runtime errors hammering the Messages screen:
--   1. messaging.threadCallContact: "column tp.created_at does not exist"
--      -> migration 0074 (thread_call_contact) ORDERs BY tp.created_at, but
--         thread_participants (migration 0002) never had a created_at column.
--   2. messaging.listMessages / getThread: "infinite recursion detected in
--      policy for relation thread_participants"
--      -> the chat_threads policy selects from thread_participants AND the
--         thread_participants policy selects from chat_threads. Each table's RLS
--         re-triggers the other's, so Postgres aborts with infinite recursion.
--
-- Fix: (a) add the missing created_at column, and (b) break the policy cycle by
-- moving the cross-table membership checks into SECURITY DEFINER helper
-- functions that run without RLS, so policies never re-enter each other.
-- Idempotent.

-- =========================================================================
-- 1) Missing column used by thread_call_contact()
-- =========================================================================
alter table public.thread_participants
  add column if not exists created_at timestamptz not null default now();

-- =========================================================================
-- 2) SECURITY DEFINER membership helpers (bypass RLS -> no recursion)
-- =========================================================================
create or replace function public.is_thread_participant(p_thread_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
      from public.thread_participants tp
     where tp.thread_id = p_thread_id
       and tp.user_id = auth.uid()
  );
$$;
grant execute on function public.is_thread_participant(uuid) to authenticated;

create or replace function public.is_thread_creator(p_thread_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
      from public.chat_threads t
     where t.id = p_thread_id
       and t.created_by = auth.uid()
  );
$$;
grant execute on function public.is_thread_creator(uuid) to authenticated;

-- =========================================================================
-- 3) Rewrite the three messaging policies to use the helpers (no cross-table
--    RLS evaluation -> recursion gone). Access semantics are unchanged.
-- =========================================================================
drop policy if exists "threads_participant" on public.chat_threads;
create policy "threads_participant" on public.chat_threads for all
  using (
    public.is_admin()
    or created_by = auth.uid()
    or public.is_thread_participant(id)
  )
  with check (created_by = auth.uid() or public.is_admin());

drop policy if exists "tp_self" on public.thread_participants;
create policy "tp_self" on public.thread_participants for all
  using (
    public.is_admin()
    or user_id = auth.uid()
    or public.is_thread_creator(thread_id)
  )
  with check (
    public.is_admin()
    or user_id = auth.uid()
    or public.is_thread_creator(thread_id)
  );

drop policy if exists "tm_via_thread" on public.thread_messages;
create policy "tm_via_thread" on public.thread_messages for all
  using (
    public.is_admin()
    or public.is_thread_participant(thread_id)
  )
  with check (
    sender_user_id = auth.uid()
    and public.is_thread_participant(thread_id)
  );
