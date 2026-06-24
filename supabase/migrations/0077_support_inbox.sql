-- 0077_support_inbox.sql
-- Gives the dock2door support/admin team a real inbox: a way to SEE every
-- support conversation (not only the ones they were auto-added to) and to JOIN
-- one so they can reply.
--
-- Why this is needed:
--   open_support_thread() (migration 0074) adds the *currently existing* admins
--   as participants when a user first opens support. Any admin/super-admin
--   created later, or who simply wants a single inbox of all support requests,
--   had no way to list every Support thread or to post into one (the
--   thread_messages INSERT policy requires the sender to be a participant).
--
-- Both functions are admin-only (is_admin() already covers Admin + SuperAdmin)
-- and SECURITY DEFINER so they bypass RLS without widening it for everyone.
-- Idempotent.

-- =========================================================================
-- 1) list_support_threads() — every Support conversation, newest first
-- =========================================================================
create or replace function public.list_support_threads()
returns table (
  id              uuid,
  subject         text,
  updated_at      timestamptz,
  requester_id    uuid,
  requester_name  text,
  requester_email text,
  last_message    text,
  is_member       boolean
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
      )                                                         as is_member
    from public.chat_threads t
    left join public.profiles p on p.id = t.created_by
   where t.scope = 'Support'
   order by t.updated_at desc;
end;
$$;

grant execute on function public.list_support_threads() to authenticated;

-- =========================================================================
-- 2) admin_join_thread(p_thread_id) — make the calling admin a participant so
--    they can read + reply (thread_messages INSERT requires participation).
-- =========================================================================
create or replace function public.admin_join_thread(p_thread_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  insert into public.thread_participants (thread_id, user_id)
  values (p_thread_id, auth.uid())
  on conflict (thread_id, user_id) do nothing;
end;
$$;

grant execute on function public.admin_join_thread(uuid) to authenticated;
