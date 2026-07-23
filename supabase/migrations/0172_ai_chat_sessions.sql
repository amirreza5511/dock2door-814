-- =========================================================================
-- 0172 — AI Copilot chat SESSIONS
-- Idempotent & additive. Safe to run multiple times.
--
-- Until now every user's copilot messages lived in one flat thread and the
-- "new chat" button DELETED them. This groups messages into sessions so past
-- conversations are preserved and browsable. Existing rows are backfilled into
-- one legacy session per user.
-- =========================================================================

alter table public.ai_chat_messages add column if not exists session_id uuid;

-- Backfill: fold each user's existing messages into a single legacy session.
do $$
declare r record; v_sid uuid;
begin
  for r in select distinct user_id from public.ai_chat_messages where session_id is null loop
    v_sid := gen_random_uuid();
    update public.ai_chat_messages
       set session_id = v_sid
     where user_id = r.user_id and session_id is null;
  end loop;
end $$;

create index if not exists idx_ai_chat_session
  on public.ai_chat_messages(user_id, session_id, created_at asc);

-- List a user's chat sessions, newest activity first, with a title derived from
-- the first user message.
create or replace function public.ai_chat_sessions()
returns table (
  session_id uuid,
  title text,
  msg_count bigint,
  started_at timestamptz,
  last_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    m.session_id,
    coalesce(
      (array_agg(m.content order by m.created_at asc) filter (where m.role = 'user'))[1],
      'گفتگو'
    ) as title,
    count(*) as msg_count,
    min(m.created_at) as started_at,
    max(m.created_at) as last_at
  from public.ai_chat_messages m
  where m.user_id = auth.uid() and m.session_id is not null
  group by m.session_id
  order by max(m.created_at) desc
  limit 50;
$$;
grant execute on function public.ai_chat_sessions() to authenticated;

notify pgrst, 'reload schema';
