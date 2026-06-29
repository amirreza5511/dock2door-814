-- 0088_load_chat.sql
-- Load-scoped messaging so everyone tied to a load can talk to each other in-app:
--   * Shipper (who posted the load) <-> the driver running it
--   * A fleet dispatcher (trucking-company member) <-> their assigned driver
--   * Either side can also reach the other for pickup / drop-off coordination
--
-- Mirrors open_shift_thread (0073): a SECURITY DEFINER helper finds (or creates)
-- the single thread for a load and makes sure every relevant party is a
-- participant, since RLS only lets a caller add themselves.
--
-- The existing thread_call_contact(thread) (0074) already powers the in-thread
-- tap-to-call button, so no extra call plumbing is needed.
--
-- Idempotent.

alter table public.chat_threads
  add column if not exists load_id uuid references public.loads(id) on delete set null;

create index if not exists idx_chat_threads_load on public.chat_threads(load_id);

create or replace function public.open_load_thread(p_load_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_load      public.loads;
  v_thread_id uuid;
  v_is_poster boolean;
  v_is_driver boolean;
  v_is_carrier boolean;
  v_subject   text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select * into v_load from public.loads where id = p_load_id;
  if not found then
    raise exception 'Load not found' using errcode = 'P0002';
  end if;

  -- Who is allowed into this conversation:
  --   the shipper who posted it, the assigned driver, members of the carrier
  --   company that accepted it, members of the poster's company, or an admin.
  v_is_poster := v_load.poster_user_id = auth.uid()
                 or public.is_member_of(v_load.poster_company_id);
  v_is_driver := v_load.accepted_driver_user_id = auth.uid();
  v_is_carrier := public.is_member_of(v_load.accepted_company_id);

  if not (v_is_poster or v_is_driver or v_is_carrier or public.is_admin()) then
    raise exception 'Not authorized for this load' using errcode = '42501';
  end if;

  -- Reuse the existing thread for this load if one already exists.
  select id into v_thread_id
    from public.chat_threads
   where load_id = p_load_id
   order by created_at asc
   limit 1;

  v_subject := 'Load: '
               || coalesce(nullif(v_load.pickup_city, ''), 'Pickup')
               || ' → '
               || coalesce(nullif(v_load.dropoff_city, ''), 'Drop-off');

  if v_thread_id is null then
    insert into public.chat_threads (scope, load_id, company_id, subject, created_by)
    values ('Direct', p_load_id,
            coalesce(v_load.accepted_company_id, v_load.poster_company_id),
            v_subject, auth.uid())
    returning id into v_thread_id;
  end if;

  -- Shipper who posted the load.
  if v_load.poster_user_id is not null then
    insert into public.thread_participants (thread_id, user_id)
    values (v_thread_id, v_load.poster_user_id)
    on conflict (thread_id, user_id) do nothing;
  end if;

  -- Assigned driver (once dispatched / accepted by a driver).
  if v_load.accepted_driver_user_id is not null then
    insert into public.thread_participants (thread_id, user_id)
    values (v_thread_id, v_load.accepted_driver_user_id)
    on conflict (thread_id, user_id) do nothing;
  end if;

  -- The caller (covers a fleet dispatcher who is neither poster nor driver).
  insert into public.thread_participants (thread_id, user_id)
  values (v_thread_id, auth.uid())
  on conflict (thread_id, user_id) do nothing;

  return v_thread_id;
end;
$$;

grant execute on function public.open_load_thread(uuid) to authenticated;
