-- 0074_support_thread_and_call_contact.sql
-- Two helpers that round out in-app communication for Labour:
--   1. open_support_thread()        — a direct conversation between any user and
--                                      the dock2door support/admin team. Creates
--                                      (or reuses) a per-user "Support" thread and
--                                      makes the caller + every admin a participant,
--                                      so support can actually see and reply.
--   2. thread_call_contact(thread)  — returns the counterpart's display name and a
--                                      phone number (if any) for an in-app tap-to-call
--                                      button. SECURITY DEFINER so it can read the
--                                      counterpart's phone without widening RLS.
--
-- Idempotent. No schema changes beyond what already exists (chat_threads,
-- thread_participants, worker_profiles.phone, companies.*_contact_phone).

-- =========================================================================
-- 1) open_support_thread() — caller <-> dock2door support/admins
-- =========================================================================
create or replace function public.open_support_thread()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_thread_id uuid;
  r           record;
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
    insert into public.chat_threads (scope, subject, created_by)
    values ('Support', 'dock2door Support', auth.uid())
    returning id into v_thread_id;
  end if;

  -- Caller is always a participant.
  insert into public.thread_participants (thread_id, user_id)
  values (v_thread_id, auth.uid())
  on conflict (thread_id, user_id) do nothing;

  -- Every admin / super-admin joins so support can see and reply.
  for r in
    select id from public.profiles where role in ('Admin', 'SuperAdmin')
  loop
    insert into public.thread_participants (thread_id, user_id)
    values (v_thread_id, r.id)
    on conflict (thread_id, user_id) do nothing;
  end loop;

  return v_thread_id;
end;
$$;

grant execute on function public.open_support_thread() to authenticated;

-- =========================================================================
-- 2) thread_call_contact(p_thread_id) — counterpart name + phone for tap-to-call
-- =========================================================================
create or replace function public.thread_call_contact(p_thread_id uuid)
returns table (name text, phone text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_other uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  -- Caller must be a participant of this thread.
  if not exists (
    select 1 from public.thread_participants
    where thread_id = p_thread_id and user_id = auth.uid()
  ) then
    raise exception 'Not authorized for this thread' using errcode = '42501';
  end if;

  -- Pick the most recently active counterpart (first non-self participant).
  select tp.user_id into v_other
    from public.thread_participants tp
   where tp.thread_id = p_thread_id and tp.user_id <> auth.uid()
   order by tp.created_at asc
   limit 1;

  if v_other is null then
    return;
  end if;

  return query
    select
      coalesce(nullif(p.name, ''), 'Contact') as name,
      coalesce(
        nullif(wp.phone, ''),
        nullif(c.public_contact_phone, ''),
        nullif(c.admin_contact_phone, ''),
        ''
      ) as phone
    from public.profiles p
    left join public.worker_profiles wp on wp.user_id = p.id
    left join public.companies c on c.id = p.company_id
   where p.id = v_other;
end;
$$;

grant execute on function public.thread_call_contact(uuid) to authenticated;
