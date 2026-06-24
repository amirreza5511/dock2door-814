-- 0078_support_ai_first.sql
-- Makes dock2door Support AI-first:
--   * A user's Support conversation is answered by the in-app AI assistant FIRST.
--   * Real admins/support staff are NOT pulled in until the conversation is
--     escalated (the AI can't resolve it, or the user asks for a human).
--   * Once escalated, admins join and reply directly, just like before.
--
-- Two small additive columns + adjusted helper functions. No RLS changes, no
-- enum changes (status is plain text), so this is low-risk and idempotent.

-- =========================================================================
-- 1) Columns
-- =========================================================================
-- Distinguishes who authored a message inside a thread. AI replies are stored
-- with sender_user_id = the user (the only id RLS allows them to insert) but
-- author_kind = 'ai' so the UI renders them as the assistant, not the user.
alter table public.thread_messages
  add column if not exists author_kind text not null default 'user';

-- Support lifecycle: 'ai' = AI is handling it, 'human' = escalated to staff.
alter table public.chat_threads
  add column if not exists support_status text;

-- Existing Support threads were already human-handled (admins joined on open),
-- so keep them as 'human' to preserve current behavior.
update public.chat_threads
   set support_status = 'human'
 where scope = 'Support' and support_status is null;

-- =========================================================================
-- 2) open_support_thread() — AI-first (no admins joined up front)
-- =========================================================================
create or replace function public.open_support_thread()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_thread_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  -- Reuse the caller's existing support thread if there is one.
  select t.id into v_thread_id
    from public.chat_threads t
    join public.thread_participants tp
      on tp.thread_id = t.id and tp.user_id = auth.uid()
   where t.scope = 'Support'
   order by t.created_at asc
   limit 1;

  if v_thread_id is null then
    insert into public.chat_threads (scope, subject, created_by, support_status)
    values ('Support', 'dock2door Support', auth.uid(), 'ai')
    returning id into v_thread_id;
  end if;

  -- Caller is always a participant. Admins are intentionally NOT added here —
  -- the AI assistant answers first; escalate_support_thread() brings in humans.
  insert into public.thread_participants (thread_id, user_id)
  values (v_thread_id, auth.uid())
  on conflict (thread_id, user_id) do nothing;

  return v_thread_id;
end;
$$;

grant execute on function public.open_support_thread() to authenticated;

-- =========================================================================
-- 3) escalate_support_thread() — hand the conversation to real humans
-- =========================================================================
create or replace function public.escalate_support_thread(p_thread_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  -- Only a participant of the thread (i.e. the requester) can escalate it.
  if not exists (
    select 1 from public.thread_participants
    where thread_id = p_thread_id and user_id = auth.uid()
  ) then
    raise exception 'Not authorized for this thread' using errcode = '42501';
  end if;

  update public.chat_threads
     set support_status = 'human', updated_at = now()
   where id = p_thread_id and scope = 'Support';

  -- Bring in every admin / super-admin so support can see and reply.
  for r in
    select id from public.profiles where role in ('Admin', 'SuperAdmin')
  loop
    insert into public.thread_participants (thread_id, user_id)
    values (p_thread_id, r.id)
    on conflict (thread_id, user_id) do nothing;
  end loop;
end;
$$;

grant execute on function public.escalate_support_thread(uuid) to authenticated;

-- =========================================================================
-- 4) list_support_threads() — include support_status for the admin inbox
-- =========================================================================
-- The return signature gained a new column (support_status) vs. migration 0077,
-- and Postgres refuses to change a function's OUT columns with CREATE OR REPLACE.
-- Drop the old definition first so the new one can be created cleanly.
drop function if exists public.list_support_threads();

create or replace function public.list_support_threads()
returns table (
  id              uuid,
  subject         text,
  updated_at      timestamptz,
  requester_id    uuid,
  requester_name  text,
  requester_email text,
  last_message    text,
  is_member       boolean,
  support_status  text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return query
    select
      t.id,
      t.subject,
      t.updated_at,
      t.created_by                                              as requester_id,
      coalesce(nullif(p.name, ''), 'User')                      as requester_name,
      coalesce(p.email, '')                                     as requester_email,
      (
        select m.body
          from public.thread_messages m
         where m.thread_id = t.id
         order by m.created_at desc
         limit 1
      )                                                         as last_message,
      exists (
        select 1 from public.thread_participants tp
         where tp.thread_id = t.id and tp.user_id = auth.uid()
      )                                                         as is_member,
      coalesce(t.support_status, 'human')                       as support_status
    from public.chat_threads t
    left join public.profiles p on p.id = t.created_by
   where t.scope = 'Support'
     -- Only surface conversations that actually need a human (escalated). Pure
     -- AI chats stay out of the staff inbox until the user asks for a person.
     and coalesce(t.support_status, 'human') = 'human'
   order by t.updated_at desc;
end;
$$;

grant execute on function public.list_support_threads() to authenticated;
