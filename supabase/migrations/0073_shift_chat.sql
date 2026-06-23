-- 0073_shift_chat.sql
-- Shift-scoped messaging between an employer and the worker(s) assigned to a shift.
--
-- Adds a `shift_id` link to chat_threads and a SECURITY DEFINER helper that, given
-- a shift, returns the existing thread for that shift (or creates one) and makes
-- sure BOTH sides — the employer who posted the shift and every non-cancelled
-- assigned worker — are participants. Without this, a worker creating a thread
-- could only add themselves (per the tp_self RLS policy), so the counterpart would
-- never receive the conversation.
--
-- Idempotent.

alter table public.chat_threads
  add column if not exists shift_id uuid references public.shift_posts(id) on delete set null;

create index if not exists idx_chat_threads_shift on public.chat_threads(shift_id);

create or replace function public.open_shift_thread(p_shift_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift     public.shift_posts;
  v_thread_id uuid;
  v_is_emp    boolean;
  v_is_worker boolean;
  r           record;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select * into v_shift from public.shift_posts where id = p_shift_id;
  if not found then
    raise exception 'Shift not found' using errcode = 'P0002';
  end if;

  -- Caller must be the employer side (admin / shift creator / employer-company member)
  -- or a worker assigned to this shift.
  v_is_emp := public.is_admin()
              or v_shift.created_by = auth.uid()
              or public.is_member_of(v_shift.employer_company_id);

  v_is_worker := exists (
    select 1 from public.shift_assignments a
    where a.shift_id = p_shift_id and a.worker_user_id = auth.uid()
  );

  if not (v_is_emp or v_is_worker) then
    raise exception 'Not authorized for this shift' using errcode = '42501';
  end if;

  -- Reuse an existing thread for this shift if one already exists.
  select id into v_thread_id
    from public.chat_threads
   where shift_id = p_shift_id
   order by created_at asc
   limit 1;

  if v_thread_id is null then
    insert into public.chat_threads (scope, shift_id, company_id, subject, created_by)
    values ('Direct', p_shift_id, v_shift.employer_company_id,
            coalesce(nullif(v_shift.title, ''), 'Shift'), auth.uid())
    returning id into v_thread_id;
  end if;

  -- Employer who posted the shift.
  if v_shift.created_by is not null then
    insert into public.thread_participants (thread_id, user_id)
    values (v_thread_id, v_shift.created_by)
    on conflict (thread_id, user_id) do nothing;
  end if;

  -- Every non-cancelled assigned worker.
  for r in
    select distinct worker_user_id
      from public.shift_assignments
     where shift_id = p_shift_id and status <> 'Cancelled'
  loop
    insert into public.thread_participants (thread_id, user_id)
    values (v_thread_id, r.worker_user_id)
    on conflict (thread_id, user_id) do nothing;
  end loop;

  -- The caller (covers employer-company members who aren't the original creator).
  insert into public.thread_participants (thread_id, user_id)
  values (v_thread_id, auth.uid())
  on conflict (thread_id, user_id) do nothing;

  return v_thread_id;
end;
$$;

grant execute on function public.open_shift_thread(uuid) to authenticated;
