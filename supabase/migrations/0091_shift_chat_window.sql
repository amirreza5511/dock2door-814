-- 0091_shift_chat_window.sql
-- Restrict shift-scoped messaging to the active window of a shift.
--
-- Rule requested by product: an employer and a worker may only message each other
-- once the worker has been ACCEPTED onto the shift (an assignment exists with
-- status Scheduled or InProgress), and they can no longer message once the shift
-- is over (assignment Completed / HoursConfirmed / Confirmed / Cancelled / NoShow,
-- or no active assignment at all).
--
-- This only affects threads linked to a shift (chat_threads.shift_id is not null).
-- Support threads, load threads and any other conversation are untouched.
--
-- Two layers of enforcement:
--   1) open_shift_thread refuses to open/reuse a thread unless an active
--      assignment exists.
--   2) a BEFORE INSERT trigger on thread_messages blocks new messages in a
--      shift thread once the active window has closed.
--
-- Idempotent.

-- Helper: is this shift currently inside its messaging window?
create or replace function public.shift_chat_is_open(p_shift_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.shift_assignments a
     where a.shift_id = p_shift_id
       and a.status in ('Scheduled', 'InProgress')
  );
$$;
grant execute on function public.shift_chat_is_open(uuid) to authenticated;

-- 1) Gate thread opening on an active assignment.
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

  -- Messaging window: only while the worker is accepted and the shift is not over.
  if not public.shift_chat_is_open(p_shift_id) then
    raise exception 'Messaging is only available once a worker is accepted and the shift is still active.'
      using errcode = '42501';
  end if;

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

  if v_shift.created_by is not null then
    insert into public.thread_participants (thread_id, user_id)
    values (v_thread_id, v_shift.created_by)
    on conflict (thread_id, user_id) do nothing;
  end if;

  for r in
    select distinct worker_user_id
      from public.shift_assignments
     where shift_id = p_shift_id and status <> 'Cancelled'
  loop
    insert into public.thread_participants (thread_id, user_id)
    values (v_thread_id, r.worker_user_id)
    on conflict (thread_id, user_id) do nothing;
  end loop;

  insert into public.thread_participants (thread_id, user_id)
  values (v_thread_id, auth.uid())
  on conflict (thread_id, user_id) do nothing;

  return v_thread_id;
end;
$$;
grant execute on function public.open_shift_thread(uuid) to authenticated;

-- 2) Block sending into a shift thread once the window is closed.
create or replace function public.enforce_shift_chat_window()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift uuid;
begin
  select shift_id into v_shift
    from public.chat_threads
   where id = NEW.thread_id;

  -- Not a shift thread (support / load / direct) → no window restriction here.
  if v_shift is null then
    return NEW;
  end if;

  if not public.shift_chat_is_open(v_shift) then
    raise exception 'This conversation is closed. You can only message while the shift is active.'
      using errcode = '42501';
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_enforce_shift_chat_window on public.thread_messages;
create trigger trg_enforce_shift_chat_window
  before insert on public.thread_messages
  for each row execute function public.enforce_shift_chat_window();
